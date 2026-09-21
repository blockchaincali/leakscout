import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  answerLeakScoutQuestion,
  answerPublicLeakScoutQuestion,
  type VerifiedLeakScoutContext,
} from '../agent/assistant.js'
import { AssistantInferenceError } from '../errors.js'
import {
  classifyProviderError,
  createProviderDiagnostic,
  logProviderDiagnostic,
  type ProviderDiagnostic,
} from '../../lib/providerErrors.js'

const context = { feature: 'brief', model: 'openai/gpt-6-astra' }

function providerError(status: number, code: string, type = 'provider_error') {
  return Object.assign(new Error('private prompt and sk-live-never-log'), {
    status,
    code,
    type,
  })
}

test('provider HTTP failures classify authentication, invalid request, model, rate limit and gateway status', () => {
  assert.deepEqual(classifyProviderError(providerError(401, 'invalid_api_key', 'authentication_error'), context), {
    ...context,
    classification: 'provider_authentication_failure',
    upstreamStatus: 401,
    upstreamType: 'authentication_error',
    upstreamCode: 'invalid_api_key',
  })
  assert.equal(classifyProviderError(providerError(400, 'invalid_request_error'), context).classification, 'provider_invalid_request')
  assert.equal(classifyProviderError(providerError(404, 'model_not_found'), context).classification, 'provider_model_not_found')
  assert.equal(classifyProviderError(providerError(429, 'rate_limit_exceeded'), context).classification, 'provider_rate_limit')
  assert.equal(classifyProviderError(providerError(503, 'upstream_unavailable'), context).classification, 'provider_gateway_failure')
})

test('provider timeout, local output-contract and grounding failures remain distinct', () => {
  const timeout = new Error('private timeout context')
  timeout.name = 'TimeoutError'
  assert.equal(classifyProviderError(timeout, context).classification, 'provider_timeout')
  assert.equal(createProviderDiagnostic('structured_output_failure', context).classification, 'structured_output_failure')
  assert.equal(createProviderDiagnostic('grounding_failure', context).classification, 'grounding_failure')
})

test('provider diagnostic logs exclude API keys, provider messages and merchant context', () => {
  const originalError = console.error
  const logLines: string[] = []
  console.error = (...values: unknown[]) => logLines.push(values.map(String).join(' '))
  try {
    const diagnostic = classifyProviderError(
      providerError(401, 'invalid_api_key'),
      { ...context, completedModelTrace: ['scout', 'investigator'] },
    )
    logProviderDiagnostic(Object.assign(diagnostic, {
      apiKey: 'sk-live-never-log',
      merchantContext: 'PRIVATE_MERCHANT_CONTEXT_SENTINEL',
    }) as ProviderDiagnostic)
  } finally {
    console.error = originalError
  }
  const output = logLines.join('\n')
  assert.match(output, /401/)
  assert.match(output, /openai\/gpt-6-astra/)
  assert.doesNotMatch(output, /sk-live-never-log|private prompt|merchant context|PRIVATE_MERCHANT_CONTEXT_SENTINEL/)
})

test('public assistant preserves a generic client error while logging only safe provider diagnostics', async () => {
  const originalError = console.error
  const logLines: string[] = []
  console.error = (...values: unknown[]) => logLines.push(values.map(String).join(' '))
  try {
    await assert.rejects(
      answerPublicLeakScoutQuestion({ question: 'product help' }, {
        complete: async () => { throw providerError(401, 'invalid_api_key') },
      }),
      (error: unknown) => {
        assert.ok(error instanceof AssistantInferenceError)
        assert.equal(error.message, 'The LeakScout assistant is temporarily unavailable.')
        assert.equal(error.diagnostic?.classification, 'provider_authentication_failure')
        return true
      },
    )
  } finally {
    console.error = originalError
  }
  const output = logLines.join('\n')
  assert.match(output, /public_assistant/)
  assert.match(output, /401/)
  assert.doesNotMatch(output, /sk-live-never-log|private prompt|product help/)
})

test('successful provider calls distinguish structured-output and grounding failures in safe logs', async () => {
  const context: VerifiedLeakScoutContext = {
    currency: 'NGN',
    status: 'completed',
    dataMode: 'full',
    verifiedSignalCount: 1,
    priorities: [{
      candidateId: 'C1',
      category: 'sales_anomaly',
      title: 'Verified signal',
      urgency: 'today',
      evidence: ['PRIVATE_MERCHANT_CONTEXT_SENTINEL'],
      recommendedAction: 'Review the verified records.',
    }],
    limitations: [],
  }
  const originalError = console.error
  const logLines: string[] = []
  console.error = (...values: unknown[]) => logLines.push(values.map(String).join(' '))
  try {
    await assert.rejects(answerPublicLeakScoutQuestion({ question: 'Help' }, {
      complete: async () => ({ content: 'not-json' }),
    }), (error: unknown) => {
      assert.ok(error instanceof AssistantInferenceError)
      assert.equal(error.diagnostic?.classification, 'structured_output_failure')
      return true
    })
    await assert.rejects(answerLeakScoutQuestion({
      context,
      question: 'Explain the finding',
    }, {
      complete: async () => ({
        content: JSON.stringify({
          answer: 'This finding is worth a review.',
          referencedCandidateIds: ['C999'],
          suggestedQuestions: [],
        }),
      }),
    }), (error: unknown) => {
      assert.ok(error instanceof AssistantInferenceError)
      assert.equal(error.diagnostic?.classification, 'grounding_failure')
      return true
    })
  } finally {
    console.error = originalError
  }
  const output = logLines.join('\n')
  assert.match(output, /structured_output_failure/)
  assert.match(output, /grounding_failure/)
  assert.doesNotMatch(output, /PRIVATE_MERCHANT_CONTEXT_SENTINEL|Explain the finding/)
})
