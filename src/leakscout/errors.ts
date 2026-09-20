export class InputError extends Error {
  readonly statusCode = 400

  constructor(message: string) {
    super(message)
    this.name = 'InputError'
  }
}

export class AssistantInferenceError extends Error {
  readonly statusCode = 502

  constructor(message = 'The LeakScout assistant is temporarily unavailable.') {
    super(message)
    this.name = 'AssistantInferenceError'
  }
}
