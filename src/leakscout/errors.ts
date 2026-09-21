import type { ProviderDiagnostic } from '../lib/providerErrors.js'

export class InputError extends Error {
  readonly statusCode = 400

  constructor(message: string) {
    super(message)
    this.name = 'InputError'
  }
}

export class AssistantInferenceError extends Error {
  readonly statusCode = 502
  readonly diagnostic?: ProviderDiagnostic

  constructor(
    message = 'The LeakScout assistant is temporarily unavailable.',
    diagnostic?: ProviderDiagnostic,
  ) {
    super(message)
    this.name = 'AssistantInferenceError'
    this.diagnostic = diagnostic
  }
}
