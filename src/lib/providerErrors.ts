export type ProviderFailureClassification =
  | 'provider_authentication_failure'
  | 'provider_rate_limit'
  | 'provider_model_not_found'
  | 'provider_invalid_request'
  | 'provider_gateway_failure'
  | 'provider_timeout'
  | 'empty_model_response'
  | 'structured_output_failure'
  | 'grounding_failure'
  | 'unknown_provider_failure'

export type ProviderDiagnostic = {
  feature: string
  model: string
  classification: ProviderFailureClassification
  upstreamStatus?: number
  upstreamType?: string
  upstreamCode?: string
  completedModelTrace?: string[]
}

export type ProviderDiagnosticContext = {
  feature: string
  model: string
  completedModelTrace?: string[]
}

function safeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(candidate) ? candidate : undefined
}

function safeModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  return candidate.includes('/') && /^[A-Za-z0-9_.:/-]{1,160}$/.test(candidate)
    ? candidate
    : undefined
}

function errorField(error: unknown, field: string): unknown {
  if (!error || typeof error !== 'object') return undefined
  return (error as Record<string, unknown>)[field]
}

function safeStatus(error: unknown): number | undefined {
  const response = errorField(error, 'response')
  const raw = errorField(error, 'status') ?? errorField(error, 'statusCode') ??
    (response && typeof response === 'object'
      ? (response as Record<string, unknown>).status
      : undefined)
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 100 && raw <= 599
    ? raw
    : undefined
}

function providerErrorObject(error: unknown): Record<string, unknown> | undefined {
  const nested = errorField(error, 'error')
  return nested && typeof nested === 'object'
    ? nested as Record<string, unknown>
    : undefined
}

export function classifyProviderError(
  error: unknown,
  context: ProviderDiagnosticContext,
): ProviderDiagnostic {
  const nested = providerErrorObject(error)
  const upstreamStatus = safeStatus(error)
  const upstreamType = safeIdentifier(errorField(error, 'type') ?? nested?.type)
  const upstreamCode = safeIdentifier(errorField(error, 'code') ?? nested?.code)
  const errorName = safeIdentifier(errorField(error, 'name'))?.toLowerCase() ?? ''
  const code = upstreamCode?.toLowerCase() ?? ''
  const rawMessage = errorField(error, 'message')
  const missingApiKey = typeof rawMessage === 'string' &&
    /OPENROUTER_API_KEY is not set/i.test(rawMessage)

  let classification: ProviderFailureClassification
  if (
    errorName.includes('timeout') ||
    ['etimedout', 'econnaborted', 'und_err_connect_timeout'].includes(code)
  ) {
    classification = 'provider_timeout'
  } else if (missingApiKey || upstreamStatus === 401 || upstreamStatus === 403 || /invalid_api_key|unauthorized|authentication/.test(code)) {
    classification = 'provider_authentication_failure'
  } else if (upstreamStatus === 429 || /rate_limit|quota_exceeded/.test(code)) {
    classification = 'provider_rate_limit'
  } else if (upstreamStatus === 404 || /model_not_found|invalid_model/.test(code)) {
    classification = 'provider_model_not_found'
  } else if (upstreamStatus === 400 || upstreamStatus === 422 || /invalid_request|bad_request/.test(code)) {
    classification = 'provider_invalid_request'
  } else if (upstreamStatus !== undefined && upstreamStatus >= 500) {
    classification = 'provider_gateway_failure'
  } else if (errorName.includes('connection') || ['enotfound', 'econnrefused', 'ehostunreach'].includes(code)) {
    classification = 'provider_gateway_failure'
  } else {
    classification = 'unknown_provider_failure'
  }

  return {
    feature: safeIdentifier(context.feature) ?? 'unknown_feature',
    model: safeModel(context.model) ?? 'unknown_model',
    classification,
    ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
    ...(upstreamType ? { upstreamType } : {}),
    ...(upstreamCode ? { upstreamCode } : {}),
    ...(context.completedModelTrace?.length
      ? { completedModelTrace: context.completedModelTrace.map((role) => safeIdentifier(role) ?? 'unknown') }
      : {}),
  }
}

export function createProviderDiagnostic(
  classification: ProviderFailureClassification,
  context: ProviderDiagnosticContext,
  upstream?: Pick<ProviderDiagnostic, 'upstreamStatus' | 'upstreamType' | 'upstreamCode'>,
): ProviderDiagnostic {
  return {
    feature: safeIdentifier(context.feature) ?? 'unknown_feature',
    model: safeModel(context.model) ?? 'unknown_model',
    classification,
    ...(upstream?.upstreamStatus === undefined ? {} : { upstreamStatus: upstream.upstreamStatus }),
    ...(safeIdentifier(upstream?.upstreamType) ? { upstreamType: safeIdentifier(upstream?.upstreamType) } : {}),
    ...(safeIdentifier(upstream?.upstreamCode) ? { upstreamCode: safeIdentifier(upstream?.upstreamCode) } : {}),
    ...(context.completedModelTrace?.length
      ? { completedModelTrace: context.completedModelTrace.map((role) => safeIdentifier(role) ?? 'unknown') }
      : {}),
  }
}

export function logProviderDiagnostic(diagnostic: ProviderDiagnostic): void {
  const classifications: ProviderFailureClassification[] = [
    'provider_authentication_failure',
    'provider_rate_limit',
    'provider_model_not_found',
    'provider_invalid_request',
    'provider_gateway_failure',
    'provider_timeout',
    'empty_model_response',
    'structured_output_failure',
    'grounding_failure',
    'unknown_provider_failure',
  ]
  const classification = classifications.includes(diagnostic.classification)
    ? diagnostic.classification
    : 'unknown_provider_failure'
  const upstreamStatus = Number.isInteger(diagnostic.upstreamStatus) &&
    diagnostic.upstreamStatus! >= 100 && diagnostic.upstreamStatus! <= 599
    ? diagnostic.upstreamStatus
    : undefined
  const safe = {
    feature: safeIdentifier(diagnostic.feature) ?? 'unknown_feature',
    model: safeModel(diagnostic.model) ?? 'unknown_model',
    classification,
    ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
    ...(safeIdentifier(diagnostic.upstreamType)
      ? { upstreamType: safeIdentifier(diagnostic.upstreamType) }
      : {}),
    ...(safeIdentifier(diagnostic.upstreamCode)
      ? { upstreamCode: safeIdentifier(diagnostic.upstreamCode) }
      : {}),
    ...(diagnostic.completedModelTrace?.length
      ? { completedModelTrace: diagnostic.completedModelTrace.map((role) => safeIdentifier(role) ?? 'unknown') }
      : {}),
  }
  console.error('[LeakScout inference diagnostic]', JSON.stringify(safe))
}
