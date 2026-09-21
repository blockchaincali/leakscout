import type { ProviderFailureClassification } from '../lib/providerErrors.js'

export const PROVIDER_HEALTHCHECK_MAX_TOKENS = 128

type ProviderHealthRequest = {
  model: string
  messages: [{ role: 'user', content: string }]
  max_tokens: number
}

type ProviderHealthRequestOptions = {
  signal: AbortSignal
}

type ProviderCompletion = (
  request: ProviderHealthRequest,
  options: ProviderHealthRequestOptions,
) => Promise<unknown>

export type ProviderHealthResult = {
  feature: string
  model: string
  requestedModel: string
  returnedModel?: string
  classification: 'success' | Extract<ProviderFailureClassification, 'empty_model_response'>
  keyAccepted: true
  baseUrlReachable: true
  modelAnswered: boolean
  hasVisibleContent: boolean
  upstreamStatus: 200
  finishReason?: string
  completionTokens?: number
}

function objectField(value: unknown, field: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[field]
}

function safeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(candidate) ? candidate : undefined
}

function safeModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  return /^[A-Za-z0-9_.:/-]{1,160}$/.test(candidate) ? candidate : undefined
}

function safeTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

export function evaluateProviderHealthResponse(
  response: unknown,
  context: { feature: string, requestedModel: string },
): ProviderHealthResult {
  const choices = objectField(response, 'choices')
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined
  const message = objectField(firstChoice, 'message')
  const content = objectField(message, 'content')
  const hasVisibleContent = typeof content === 'string' && content.trim().length > 0
  const returnedModel = safeModel(objectField(response, 'model'))
  const finishReason = safeIdentifier(objectField(firstChoice, 'finish_reason'))
  const completionTokens = safeTokenCount(
    objectField(objectField(response, 'usage'), 'completion_tokens'),
  )

  return {
    feature: context.feature,
    model: context.requestedModel,
    requestedModel: context.requestedModel,
    ...(returnedModel ? { returnedModel } : {}),
    classification: hasVisibleContent ? 'success' : 'empty_model_response',
    keyAccepted: true,
    baseUrlReachable: true,
    modelAnswered: hasVisibleContent,
    hasVisibleContent,
    upstreamStatus: 200,
    ...(finishReason ? { finishReason } : {}),
    ...(completionTokens === undefined ? {} : { completionTokens }),
  }
}

export async function runProviderHealthCheck(options: {
  feature: string
  requestedModel: string
  complete: ProviderCompletion
  timeoutMs?: number
}): Promise<ProviderHealthResult> {
  const response = await options.complete({
    model: options.requestedModel,
    messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    max_tokens: PROVIDER_HEALTHCHECK_MAX_TOKENS,
  }, { signal: AbortSignal.timeout(options.timeoutMs ?? 25_000) })

  return evaluateProviderHealthResponse(response, {
    feature: options.feature,
    requestedModel: options.requestedModel,
  })
}
