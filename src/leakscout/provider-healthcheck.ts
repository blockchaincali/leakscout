import {
  classifyProviderError,
  type ProviderFailureClassification,
} from '../lib/providerErrors.js'
import { LEAKSCOUT_MODELS } from '../lib/modelConfig.js'
import { runProviderHealthCheck } from './providerHealth.js'

const roles = {
  scout: LEAKSCOUT_MODELS.scout,
  investigator: LEAKSCOUT_MODELS.investigator,
  critic: LEAKSCOUT_MODELS.critic,
  brief: LEAKSCOUT_MODELS.brief,
  chat: LEAKSCOUT_MODELS.chat,
  publicAssistant: LEAKSCOUT_MODELS.publicAssistant,
} as const

type Role = keyof typeof roles

function requestedRole(): Role {
  const index = process.argv.indexOf('--role')
  const value = index >= 0 ? process.argv[index + 1] : 'publicAssistant'
  if (value && value in roles) return value as Role
  throw new Error('Choose --role scout|investigator|critic|brief|chat|publicAssistant.')
}

function classificationForMissingKey(): ProviderFailureClassification {
  return 'provider_authentication_failure'
}

function safeBaseOrigin(value: string): string {
  try {
    return new URL(value).origin
  } catch {
    return 'invalid_url'
  }
}

async function main(): Promise<void> {
  const role = requestedRole()
  const model = roles[role]
  const baseUrl = (process.env.OPENROUTER_BASE_URL ?? 'https://api.orbio.so/api/v1').replace(/\/+$/, '')
  const baseUrlOrigin = safeBaseOrigin(baseUrl)

  if (!process.env.OPENROUTER_API_KEY) {
    console.log(JSON.stringify({
      feature: role,
      model,
      requestedModel: model,
      baseUrlOrigin,
      classification: classificationForMissingKey(),
      keyAccepted: false,
      baseUrlReachable: null,
      modelAnswered: false,
      hasVisibleContent: false,
      upstreamStatus: null,
      note: 'OPENROUTER_API_KEY is not configured; the key value was not read into output.',
    }, null, 2))
    process.exitCode = 1
    return
  }

  try {
    const { openrouter } = await import('../lib/openrouter.js')
    const result = await runProviderHealthCheck({
      feature: role,
      requestedModel: model,
      complete: (request, options) => openrouter.chat.completions.create(request, options),
    })
    console.log(JSON.stringify({
      baseUrlOrigin,
      ...result,
    }, null, 2))
    if (!result.hasVisibleContent) process.exitCode = 1
  } catch (error) {
    const diagnostic = classifyProviderError(error, { feature: role, model })
    const authFailed = diagnostic.classification === 'provider_authentication_failure'
    const reachable = diagnostic.upstreamStatus !== undefined
      ? true
      : diagnostic.classification === 'provider_gateway_failure'
        ? false
        : null
    const keyAccepted = authFailed
      ? false
      : diagnostic.upstreamStatus !== undefined && diagnostic.upstreamStatus < 500
        ? true
        : null
    console.log(JSON.stringify({
      ...diagnostic,
      requestedModel: model,
      baseUrlOrigin,
      keyAccepted,
      baseUrlReachable: reachable,
      modelAnswered: false,
      hasVisibleContent: false,
    }, null, 2))
    process.exitCode = 1
  }
}

void main().catch(() => {
  console.log(JSON.stringify({
    feature: 'provider_diagnostic',
    classification: 'unknown_provider_failure',
    keyAccepted: null,
    baseUrlReachable: null,
    modelAnswered: false,
    hasVisibleContent: false,
  }, null, 2))
  process.exitCode = 1
})
