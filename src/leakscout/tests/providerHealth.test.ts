import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PROVIDER_HEALTHCHECK_MAX_TOKENS,
  runProviderHealthCheck,
} from '../providerHealth.js'

const context = {
  feature: 'publicAssistant',
  requestedModel: 'google/gemini-3.8-flash',
}

type MockResponse = {
  model?: string
  choices: Array<{
    finish_reason?: string | null
    message: { content: string | null }
  }>
  usage?: { completion_tokens?: number }
}

async function check(response: MockResponse) {
  let request: unknown
  const result = await runProviderHealthCheck({
    ...context,
    complete: async (value) => {
      request = value
      return response
    },
  })
  return { request, result }
}

test('HTTP 200 with visible content succeeds with a diagnostic token allowance', async () => {
  const { request, result } = await check({
    choices: [{ message: { content: 'ready' } }],
  })

  assert.equal(result.classification, 'success')
  assert.equal(result.hasVisibleContent, true)
  assert.equal(result.modelAnswered, true)
  assert.equal(result.upstreamStatus, 200)
  assert.equal(
    (request as { max_tokens: number }).max_tokens,
    PROVIDER_HEALTHCHECK_MAX_TOKENS,
  )
  assert.equal(PROVIDER_HEALTHCHECK_MAX_TOKENS, 128)
})

test('HTTP 200 with empty content is an empty model response, not a structured-output failure', async () => {
  const { result } = await check({
    choices: [{ message: { content: '' } }],
  })

  assert.equal(result.classification, 'empty_model_response')
  assert.equal(result.hasVisibleContent, false)
  assert.equal(result.modelAnswered, false)
})

test('reasoning tokens can be consumed without producing visible content', async () => {
  const { result } = await check({
    choices: [{ finish_reason: 'length', message: { content: null } }],
    usage: { completion_tokens: 128 },
  })

  assert.equal(result.classification, 'empty_model_response')
  assert.equal(result.hasVisibleContent, false)
  assert.equal(result.completionTokens, 128)
  assert.equal(result.finishReason, 'length')
})

test('safe response metadata includes finish reason and requested and returned models', async () => {
  const { result } = await check({
    model: 'google/gemini-3.8-flash-20260901',
    choices: [{ finish_reason: 'stop', message: { content: 'ready' } }],
    usage: { completion_tokens: 7 },
  })

  assert.equal(result.requestedModel, 'google/gemini-3.8-flash')
  assert.equal(result.returnedModel, 'google/gemini-3.8-flash-20260901')
  assert.equal(result.finishReason, 'stop')
  assert.equal(result.completionTokens, 7)
})

test('provider response text is never copied into diagnostic logs', async () => {
  const responseText = 'PRIVATE_PROVIDER_RESPONSE_SENTINEL sk-live-never-log'
  const { result } = await check({
    choices: [{ finish_reason: 'stop', message: { content: responseText } }],
  })
  const originalLog = console.log
  const logLines: string[] = []
  console.log = (...values: unknown[]) => logLines.push(values.map(String).join(' '))
  try {
    console.log(JSON.stringify(result))
  } finally {
    console.log = originalLog
  }

  const output = logLines.join('\n')
  assert.match(output, /success/)
  assert.doesNotMatch(output, /PRIVATE_PROVIDER_RESPONSE_SENTINEL|sk-live-never-log/)
})
