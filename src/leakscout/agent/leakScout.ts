import { z } from 'zod'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'
import { DEFAULT_MODEL, openrouter } from '../../lib/openrouter.js'
import type {
  AuditResult,
  LeakCandidate,
  LeakCategory,
} from '../types.js'
import { AgentDecisionSchema } from './schemas.js'
import {
  ALL_LEAK_CATEGORIES,
  parseInvestigationCategories,
  validatePrioritySelections,
} from './validation.js'

export type CandidateWithId = LeakCandidate & {
  id: string
}

type Urgency = 'today' | 'this_week' | 'monitor'

export type VerifiedPriority = {
  candidate: CandidateWithId
  reasoning: string
  recommendedAction: string
  urgency: Urgency
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
  model: string
  toolCalls: string[]
}

const ALL_CATEGORIES: LeakCategory[] = ALL_LEAK_CATEGORIES

function withIds(candidates: LeakCandidate[]): CandidateWithId[] {
  return candidates.map((candidate, index) => ({
    ...candidate,
    id: `C${index + 1}`,
  }))
}

function categoryLabel(category: LeakCategory): string {
  switch (category) {
    case 'stockout_risk':
      return 'stockout risk'
    case 'margin_compression':
      return 'margin compression'
    case 'dead_inventory':
      return 'dead inventory'
    case 'sales_anomaly':
      return 'sales decline'
    case 'inventory_exposure':
      return 'inventory exposure'
  }
}

function safeReason(candidate: CandidateWithId): string {
  return candidate.evidence.join('; ')
}

function safeAction(candidate: CandidateWithId): string {
  switch (candidate.category) {
    case 'stockout_risk':
      return 'Reorder promptly and review the reorder threshold using recent sales velocity and supplier lead time.'

    case 'margin_compression':
      return 'Review selling price and supplier terms to restore healthy unit economics.'

    case 'dead_inventory':
      return 'Pause further reordering and consider clearance, bundling or promotion to recover working capital.'

    case 'sales_anomaly':
      return 'Investigate availability, pricing, promotions and demand changes before changing inventory commitments.'

    case 'inventory_exposure':
      return 'Review recent movement and demand before increasing this inventory position.'
  }
}

function monitorAction(candidate: CandidateWithId): string {
  switch (candidate.category) {
    case 'stockout_risk':
      return `Monitor ${candidate.productName ?? candidate.sku ?? 'the product'} inventory cover against supplier lead time.`

    case 'margin_compression':
      return `Monitor ${candidate.productName ?? candidate.sku ?? 'the product'} unit margin after pricing or supplier changes.`

    case 'dead_inventory':
      return `Monitor whether ${candidate.productName ?? candidate.sku ?? 'the product'} inventory begins moving before any reorder.`

    case 'sales_anomaly':
      return `Monitor ${candidate.productName ?? candidate.sku ?? 'the product'} sales against its previous run rate.`

    case 'inventory_exposure':
      return `Monitor ${candidate.productName ?? candidate.sku ?? 'the product'} inventory movement before reordering.`
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

export async function runLeakScoutAgent(
  audit: AuditResult,
  signal?: AbortSignal,
): Promise<LeakScoutReport> {
  const MAX_PER_CATEGORY = 8
  const limitedCandidates = ALL_CATEGORIES.flatMap((category) =>
    audit.candidates
      .filter((candidate) => candidate.category === category)
      .slice(0, MAX_PER_CATEGORY),
  )
  const included = new Set(limitedCandidates)
  const candidates = withIds(
    audit.candidates.filter((candidate) => included.has(candidate)),
  )

  if (candidates.length < 3) {
    throw new Error(
      `LeakScout requires at least 3 verified candidates, found ${candidates.length}.`,
    )
  }

  const inspectedCandidateIds = new Set<string>()
  const toolCallsUsed: string[] = []

  const InvestigationArgs = z.object({
    categories: z
      .array(
        z.enum([
          'stockout_risk',
          'margin_compression',
          'dead_inventory',
          'sales_anomaly',
          'inventory_exposure',
        ]),
      )
      .min(1)
      .describe('Leak categories to investigate.'),
  })

  const investigationTool: ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'inspect_verified_leaks',
      description:
        'Inspect deterministic, verified profit-leak candidates. Choose the categories needed to prioritize the business.',
      parameters: z.toJSONSchema(InvestigationArgs),
    },
  }

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `
You are LeakScout, an autonomous profit-leak investigator.

Your task is to determine which THREE verified issues deserve the business
owner's attention first.

Financial calculations are performed by deterministic code, not by you.

Use the investigation tool before making a decision.

When prioritizing:
- consider urgency
- consider recurring financial damage
- consider working capital exposure
- consider whether an issue could interrupt future sales
- do not assume different financial impact types are directly comparable
- do not invent candidates or financial values

Your final decision will contain candidate IDs and urgency only.
`.trim(),
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Investigate the business and prioritize its three most important verified profit leaks.',
        businessSummary: audit.summary,
        candidateCount: candidates.length,
        availableCategories: ALL_CATEGORIES,
      }),
    },
  ]

  const investigation = await openrouter.chat.completions.create(
    {
      model: DEFAULT_MODEL,
      messages,
      tools: [investigationTool],
      tool_choice: 'required',
      max_tokens: 500,
    },
    { signal },
  )

  const investigationMessage = investigation.choices[0]?.message

  if (!investigationMessage) {
    throw new Error('LeakScout returned no investigation message.')
  }

  messages.push(investigationMessage)

  if (!investigationMessage.tool_calls?.length) {
    throw new Error('LeakScout did not call its investigation tool.')
  }

  for (const call of investigationMessage.tool_calls) {
    if (call.type !== 'function') continue

    toolCallsUsed.push('inspect_verified_leaks')

    let categories: LeakCategory[] = ALL_CATEGORIES

    try {
      categories = parseInvestigationCategories(call.function.arguments)
    } catch {
      categories = ALL_CATEGORIES
    }

    const requested = candidates.filter((candidate) =>
      categories.includes(candidate.category),
    )
    const result = [...requested]

    // Always return enough verified context for the final selection without
    // paying for another investigation call.
    if (result.length < 3) {
      for (const candidate of candidates) {
        if (!result.includes(candidate)) result.push(candidate)
        if (result.length === 3) break
      }
    }

    for (const candidate of result) {
      inspectedCandidateIds.add(candidate.id)
    }

    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify(
        result.map((candidate) => ({
          id: candidate.id,
          category: candidate.category,
          productName: candidate.productName,
          title: candidate.title,
          evidence: candidate.evidence,
          impact: candidate.impact,
          confidence: candidate.confidence,
          metadata: candidate.metadata,
        })),
      ),
    })
  }

  if (inspectedCandidateIds.size < 3) {
    throw new Error('LeakScout did not inspect enough verified candidates.')
  }

  messages.push({
    role: 'user',
    content: `
Investigation is complete.

Select exactly THREE distinct verified candidate IDs.

Return only:
- candidateId
- urgency: today, this_week or monitor

Do not provide financial calculations, recommendations, prose or new facts.
`.trim(),
  })

  const final = await openrouter.chat.completions.create(
    {
      model: DEFAULT_MODEL,
      messages,
      max_tokens: 300,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'leakscout_priority_decision',
          strict: true,
          schema: z.toJSONSchema(AgentDecisionSchema),
        },
      },
      // @ts-expect-error OpenRouter provider extension.
      provider: {
        require_parameters: true,
      },
    },
    { signal },
  )

  const content = final.choices[0]?.message?.content

  if (!content) {
    throw new Error('LeakScout returned no priority decision.')
  }

  const decision = AgentDecisionSchema.parse(JSON.parse(content))

  const priorities: VerifiedPriority[] = validatePrioritySelections(
    candidates,
    decision.priorities,
    inspectedCandidateIds,
  ).map(({ candidate, urgency }) => ({
    candidate,
    reasoning: safeReason(candidate),
    recommendedAction: safeAction(candidate),
    urgency,
  }))

  const categories = dedupe(
    priorities.map((priority) =>
      categoryLabel(priority.candidate.category),
    ),
  )

  const today = priorities
    .filter((priority) => priority.urgency === 'today')
    .map((priority) => priority.recommendedAction)

  const thisWeek = priorities
    .filter((priority) => priority.urgency === 'this_week')
    .map((priority) => priority.recommendedAction)

  const monitor = priorities.map((priority) =>
    monitorAction(priority.candidate),
  )

  return {
    headline: '3 priority profit leaks need attention',
    executiveSummary:
      `LeakScout investigated verified transaction and inventory signals and prioritized ${categories.join(', ')}.`,
    priorities,
    actionPlan: {
      today: dedupe(today).slice(0, 3),
      thisWeek: dedupe(thisWeek).slice(0, 3),
      monitor: dedupe(monitor).slice(0, 3),
    },
    model: final.model ?? DEFAULT_MODEL,
    toolCalls: [...new Set(toolCallsUsed)],
  }
}
