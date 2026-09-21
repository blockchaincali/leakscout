import { z } from 'zod'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'
import { LEAKSCOUT_MODELS, LEAKSCOUT_TIMEOUTS_MS } from '../../lib/modelConfig.js'
import {
  classifyProviderError,
  createProviderDiagnostic,
  logProviderDiagnostic,
} from '../../lib/providerErrors.js'
import type {
  AuditResult,
  LeakCandidate,
} from '../types.js'
import {
  InvestigationReportSchema,
  ScoutToolArgsSchema,
} from './schemas.js'
import {
  ALL_LEAK_CATEGORIES,
  parseScoutToolArgs,
  validateCandidateIds,
} from './validation.js'

export type CandidateWithId = LeakCandidate & { id: string }
export type Urgency = 'today' | 'this_week' | 'monitor'
export type ModelRole = 'scout' | 'investigator' | 'critic'

export type ModelTraceEntry = {
  role: ModelRole
  model: string
}

export type VerifiedPriority = {
  candidate: CandidateWithId
  urgency: Urgency
  whyItMatters: string
  reasoning: string
  recommendedAction: string
  checksToPerform: string[]
  watchFor: string[]
  assumptionsOrUnknowns: string[]
}

export type LeakScoutReport = {
  headline: string
  executiveSummary: string
  priorities: VerifiedPriority[]
  actionPlan: {
    today: string[]
    thisWeek: string[]
    monitor: string[]
  }
  /** Kept for existing clients; identifies the last successful inference stage. */
  model: string
  modelTrace: ModelTraceEntry[]
  provider: 'Orbio'
  toolCalls: string[]
}

export type AgentCompletionRequest = {
  role: ModelRole
  model: string
  messages: ChatCompletionMessageParam[]
  tools?: ChatCompletionTool[]
  schema?: z.ZodType
  maxTokens: number
  signal: AbortSignal
}

export type AgentCompletionResult = {
  content: string | null
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  model?: string
}

export type AgentCompletion = (
  request: AgentCompletionRequest,
) => Promise<AgentCompletionResult>

export type LeakScoutAgentOptions = {
  complete?: AgentCompletion
}

export class LeakScoutPipelineError extends Error {
  constructor(
    message: string,
    readonly modelTrace: ModelTraceEntry[],
    readonly toolCalls: string[],
  ) {
    super(message)
    this.name = 'LeakScoutPipelineError'
  }
}

const scoutTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'inspect_verified_leaks',
    description:
      'Select verified candidate IDs for deeper investigation and specify evidence areas. The tool returns only deterministic candidates and their verified evidence.',
    parameters: z.toJSONSchema(ScoutToolArgsSchema),
  },
}

const SCOUT_SYSTEM_PROMPT = `
You are LeakScout Scout, the first stage of a business investigation.

Use inspect_verified_leaks exactly once to choose at least three and at most
fifteen verified candidate IDs for deeper investigation. Select candidates
across relevant categories and name evidence areas that the investigator
should examine. Only select IDs present in the supplied index.

You route investigation; you do not calculate, estimate, compare, or restate
money. Do not infer causes or merchant behavior. Return no narrative outside
the required tool call.
`.trim()

const INVESTIGATOR_SYSTEM_PROMPT = `
You are LeakScout's deep business investigator. The supplied summary,
limitations and selected candidates are the complete evidence available to you.

Return exactly three distinct priorities from the supplied candidate IDs.
Explain business significance and relative priority using verified facts.
Give a concrete first action, 2-4 operational checks, 1-3 watch items, and
explicit unknowns for each priority. Do not treat different impact types as
directly comparable. Keep reasoning concise; it is a business rationale, not
hidden chain of thought.

Never invent a cause, financial figure, transaction, customer or supplier
behavior, demand explanation, stock value, or other fact. If a cause is not
established, say that it cannot be confirmed from the supplied data. Do not
repeat calculations or add numeric claims beyond supplied evidence.
`.trim()

const CRITIC_SYSTEM_PROMPT = `
You are LeakScout's independent report critic. Challenge the investigator
draft against the complete deterministic context and return a corrected report
with exactly three distinct priorities.

Verify candidate IDs and evidence, reject invented causes or numbers, check
that urgency is defensible, actions fit the evidence, stronger verified
signals are not ignored, and unknowns are explicit. Do not compare unlike
financial impact types as if directly equivalent. You may reorder or replace
priorities using only verified candidate IDs and may revise all prose.

The supplied deterministic context is authoritative. Do not create or alter
impact values, evidence, financial facts or candidate IDs. Do not include
hidden chain of thought; return concise business rationale only.
`.trim()

function withIds(candidates: LeakCandidate[]): CandidateWithId[] {
  return candidates.map((candidate, index) => ({
    ...candidate,
    id: `C${index + 1}`,
  }))
}

function modelFor(role: ModelRole): string {
  return LEAKSCOUT_MODELS[role]
}

function actualModel(result: AgentCompletionResult, requested: string): string {
  return result.model?.trim() || requested
}

async function openRouterCompletion(
  request: AgentCompletionRequest,
): Promise<AgentCompletionResult> {
  const { openrouter } = await import('../../lib/openrouter.js')
  const response = await openrouter.chat.completions.create(
    {
      model: request.model,
      messages: request.messages,
      ...(request.tools
        ? { tools: request.tools, tool_choice: 'required' as const }
        : {}),
      ...(request.schema
        ? {
            response_format: {
              type: 'json_schema' as const,
              json_schema: {
                name: `leakscout_${request.role}_report`,
                strict: true,
                schema: z.toJSONSchema(request.schema),
              },
            },
          }
        : {}),
      max_tokens: request.maxTokens,
    },
    { signal: request.signal },
  )

  const message = response.choices[0]?.message
  return {
    content: message?.content ?? null,
    toolCalls: message?.tool_calls?.flatMap((call) =>
      call.type === 'function'
        ? [{
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          }]
        : [],
    ),
    model: response.model ?? undefined,
  }
}

async function completeWithTimeout(
  complete: AgentCompletion,
  request: Omit<AgentCompletionRequest, 'signal'> & { signal?: AbortSignal },
  timeoutMs: number,
  completedModelTrace: string[],
): Promise<AgentCompletionResult> {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(request.signal?.reason)
  request.signal?.addEventListener('abort', abortFromParent, { once: true })
  if (request.signal?.aborted) abortFromParent()

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      complete({ ...request, signal: controller.signal }),
      new Promise<AgentCompletionResult>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort(new Error(`${request.role} stage timed out`))
          const timeoutError = new Error(`LeakScout ${request.role} stage timed out.`)
          timeoutError.name = 'TimeoutError'
          reject(timeoutError)
        }, timeoutMs)
      }),
    ])
  } catch (error) {
    logProviderDiagnostic(classifyProviderError(error, {
      feature: request.role,
      model: request.model,
      completedModelTrace,
    }))
    throw error
  } finally {
    if (timer) clearTimeout(timer)
    request.signal?.removeEventListener('abort', abortFromParent)
  }
}

function logStageFailure(
  classification: 'structured_output_failure' | 'grounding_failure',
  role: ModelRole,
  model: string,
  completedModelTrace: string[],
): void {
  logProviderDiagnostic(createProviderDiagnostic(classification, {
    feature: role,
    model,
    completedModelTrace,
  }))
}

function decodeReport(
  result: AgentCompletionResult,
  role: ModelRole,
  requestedModel: string,
  completedModelTrace: string[],
) {
  const model = actualModel(result, requestedModel)
  if (!result.content) {
    logStageFailure('structured_output_failure', role, model, completedModelTrace)
    throw new Error('Model returned no structured report.')
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(result.content)
  } catch {
    logStageFailure('structured_output_failure', role, model, completedModelTrace)
    throw new Error('Model returned invalid JSON.')
  }
  const parsed = InvestigationReportSchema.safeParse(decoded)
  if (!parsed.success) {
    logStageFailure('structured_output_failure', role, model, completedModelTrace)
    throw new Error('Model returned an invalid investigation report.')
  }
  return parsed.data
}

function numericFacts(value: unknown): Set<number> {
  const matches = JSON.stringify(value).match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []
  return new Set(matches.flatMap((match) => {
    const number = Number(match.replaceAll(',', ''))
    return Number.isFinite(number) ? [number] : []
  }))
}

const unsupportedCausePattern =
  /\b(?:because|due to|caused by|causing|driven by|resulted from|resulting from|customers? (?:stopped|reduced|abandoned|rejected|preferred|switched)|demand (?:fell|dropped|rose|increased|declined)|supplier (?:delay|failure|shortage|increase|raised|failed))\b/i

function assertNumbersGrounded(text: string, facts: unknown): void {
  const allowedNumbers = numericFacts(facts)
  const matches = text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []
  for (const match of matches) {
    const number = Number(match.replaceAll(',', ''))
    if (!allowedNumbers.has(number)) {
      throw new Error(`Model introduced unsupported numeric claim: ${number}`)
    }
  }
}

function validateReportGrounding(
  report: z.infer<typeof InvestigationReportSchema>,
  verifiedContext: unknown,
  candidates: CandidateWithId[],
  allowedCandidateIds: ReadonlySet<string>,
): CandidateWithId[] {
  const selected = validateCandidateIds(
    candidates,
    report.priorities.map((priority) => priority.candidateId),
  )

  for (const priority of report.priorities) {
    if (!allowedCandidateIds.has(priority.candidateId)) {
      throw new Error(`Model selected uninspected candidate: ${priority.candidateId}`)
    }
  }

  const allCandidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  assertNumbersGrounded(
    `${report.headline} ${report.executiveSummary}`,
    verifiedContext,
  )
  for (const priority of report.priorities) {
    assertNumbersGrounded(
      [
        priority.whyItMatters,
        priority.reasoning,
        priority.recommendedAction,
        ...priority.checksToPerform,
        ...priority.watchFor,
        ...priority.assumptionsOrUnknowns,
      ].join(' '),
      {
        summary: (verifiedContext as { summary?: unknown }).summary,
        candidate: allCandidatesById.get(priority.candidateId),
      },
    )
  }

  const verifiedText = JSON.stringify(verifiedContext).toLowerCase()
  const prose = [
    report.headline,
    report.executiveSummary,
    ...report.priorities.flatMap((priority) => [
      priority.whyItMatters,
      priority.reasoning,
      priority.recommendedAction,
      ...priority.checksToPerform,
      ...priority.watchFor,
      ...priority.assumptionsOrUnknowns,
    ]),
  ]
  for (const text of prose) {
    const claim = text.match(unsupportedCausePattern)?.[0]
    if (claim && !verifiedText.includes(claim.toLowerCase())) {
      throw new Error(`Model introduced unsupported causal claim: ${claim}`)
    }
  }

  return selected
}

function makeReport(
  source: z.infer<typeof InvestigationReportSchema>,
  candidates: CandidateWithId[],
  trace: ModelTraceEntry[],
  toolCalls: string[],
): LeakScoutReport {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const priorities: VerifiedPriority[] = source.priorities.map((priority) => ({
    ...priority,
    candidate: candidateById.get(priority.candidateId)!,
  }))
  return {
    headline: source.headline,
    executiveSummary: source.executiveSummary,
    priorities,
    actionPlan: {
      today: priorities
        .filter((priority) => priority.urgency === 'today')
        .map((priority) => priority.recommendedAction),
      thisWeek: priorities
        .filter((priority) => priority.urgency === 'this_week')
        .map((priority) => priority.recommendedAction),
      monitor: priorities.flatMap((priority) => priority.watchFor),
    },
    model: trace.at(-1)?.model ?? 'deterministic-fallback',
    modelTrace: [...trace],
    provider: 'Orbio',
    toolCalls: [...new Set(toolCalls)],
  }
}

export async function runLeakScoutAgent(
  audit: AuditResult,
  signal?: AbortSignal,
  options: LeakScoutAgentOptions = {},
): Promise<LeakScoutReport> {
  const trace: ModelTraceEntry[] = []
  const toolCallsUsed: string[] = []
  const complete = options.complete ?? openRouterCompletion

  try {
    const candidates = withIds(audit.candidates)
    if (candidates.length < 3) {
      throw new Error(`LeakScout requires at least 3 verified candidates, found ${candidates.length}.`)
    }

    const candidateIndex = candidates.map(({ id, category, title, productName }) => ({
      id,
      category,
      title,
      productName,
    }))

    const scoutModel = modelFor('scout')
    const scout = await completeWithTimeout(complete, {
      role: 'scout',
      model: scoutModel,
      messages: [
        { role: 'system', content: SCOUT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'Route the investigation to verified signals that warrant deeper analysis.',
            dataMode: 'full',
            businessSummary: audit.summary,
            candidateIndex,
            availableCategories: ALL_LEAK_CATEGORIES,
          }),
        },
      ],
      tools: [scoutTool],
      maxTokens: 700,
      signal,
    }, LEAKSCOUT_TIMEOUTS_MS.scout, trace.map(({ role }) => role))

    const scoutCall = scout.toolCalls?.find((call) => call.name === 'inspect_verified_leaks')
    if (!scoutCall) {
      logStageFailure('structured_output_failure', 'scout', actualModel(scout, scoutModel), trace.map(({ role }) => role))
      throw new Error('Scout did not call inspect_verified_leaks.')
    }
    let selection
    try {
      selection = parseScoutToolArgs(scoutCall.arguments)
    } catch {
      logStageFailure('structured_output_failure', 'scout', actualModel(scout, scoutModel), trace.map(({ role }) => role))
      throw new Error('Scout returned invalid inspection arguments.')
    }
    let inspected: CandidateWithId[]
    try {
      inspected = validateCandidateIds(candidates, selection.candidateIds)
    } catch {
      logStageFailure('grounding_failure', 'scout', actualModel(scout, scoutModel), trace.map(({ role }) => role))
      throw new Error('Scout selected an unverified candidate.')
    }
    if (inspected.some((candidate) => !selection.categories.includes(candidate.category))) {
      logStageFailure('grounding_failure', 'scout', actualModel(scout, scoutModel), trace.map(({ role }) => role))
      throw new Error('Scout selected a candidate outside its declared categories.')
    }
    const inspectedIds = new Set(inspected.map((candidate) => candidate.id))
    toolCallsUsed.push('inspect_verified_leaks')
    trace.push({ role: 'scout', model: actualModel(scout, scoutModel) })

    const investigatorModel = modelFor('investigator')
    const investigatorResult = await completeWithTimeout(complete, {
      role: 'investigator',
      model: investigatorModel,
      messages: [
        { role: 'system', content: INVESTIGATOR_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            deterministicSummary: audit.summary,
            selectedCategories: selection.categories,
            evidenceAreasToExamine: selection.evidenceAreas,
            inspectedCandidates: inspected,
            dataQualityLimitations: audit.summary.inventoryDataQuality,
          }),
        },
      ],
      schema: InvestigationReportSchema,
      maxTokens: 2_800,
      signal,
    }, LEAKSCOUT_TIMEOUTS_MS.investigator, trace.map(({ role }) => role))
    const investigatorDraft = decodeReport(
      investigatorResult,
      'investigator',
      investigatorModel,
      trace.map(({ role }) => role),
    )
    trace.push({ role: 'investigator', model: actualModel(investigatorResult, investigatorModel) })

    const criticModel = modelFor('critic')
    let criticReport: z.infer<typeof InvestigationReportSchema> | undefined
    let criticFailure: unknown
    try {
      const criticResult = await completeWithTimeout(complete, {
        role: 'critic',
        model: criticModel,
        messages: [
          { role: 'system', content: CRITIC_SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              deterministicSummary: audit.summary,
              allVerifiedCandidates: candidates,
              scoutSelections: {
                candidateIds: selection.candidateIds,
                categories: selection.categories,
                evidenceAreas: selection.evidenceAreas,
              },
              investigatorDraft,
              dataQualityLimitations: audit.summary.inventoryDataQuality,
              task: 'Return a corrected, strictly grounded report. You may select any verified candidate in the complete context.',
            }),
          },
        ],
        schema: InvestigationReportSchema,
        maxTokens: 2_800,
        signal,
      }, LEAKSCOUT_TIMEOUTS_MS.critic, trace.map(({ role }) => role))
      const validatedCritic = decodeReport(
        criticResult,
        'critic',
        criticModel,
        trace.map(({ role }) => role),
      )
      try {
        validateReportGrounding(
          validatedCritic,
          { summary: audit.summary, candidates },
          candidates,
          new Set(candidates.map((candidate) => candidate.id)),
        )
      } catch {
        logStageFailure('grounding_failure', 'critic', actualModel(criticResult, criticModel), trace.map(({ role }) => role))
        throw new Error('Critic report failed deterministic grounding.')
      }
      criticReport = validatedCritic
      trace.push({ role: 'critic', model: actualModel(criticResult, criticModel) })
    } catch (error) {
      criticFailure = error
    }

    if (criticReport) {
      return makeReport(criticReport, candidates, trace, toolCallsUsed)
    }

    // A failed critic may leave the investigator's draft usable, but only if
    // it independently passes every deterministic grounding check.
    try {
      validateReportGrounding(
        investigatorDraft,
        { summary: audit.summary, candidates: inspected },
        inspected,
        inspectedIds,
      )
    } catch (investigatorError) {
      logStageFailure('grounding_failure', 'investigator', actualModel(investigatorResult, investigatorModel), trace.map(({ role }) => role))
      const reason = investigatorError instanceof Error
        ? investigatorError.message
        : 'Investigator draft failed local grounding.'
      throw new Error(`Critic failed and investigator draft was unsafe: ${reason}`)
    }

    void criticFailure
    return makeReport(investigatorDraft, inspected, trace, toolCallsUsed)
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'LeakScout investigation failed.'
    throw new LeakScoutPipelineError(message, trace, toolCallsUsed)
  }
}
