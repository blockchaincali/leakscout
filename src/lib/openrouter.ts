import { config } from 'dotenv'
import OpenAI from 'openai'

// `.env.local` first, `.env` as a fallback. `dotenv/config` reads only `.env`,
// which is exactly the file the README tells you not to put a key in.
config({ path: ['.env.local', '.env'], quiet: true })

/**
 * One client, one key.
 *
 * OpenRouter speaks the OpenAI wire format, so the official `openai` SDK works
 * unchanged with a different base URL. The key is the one Orbio minted for you
 * — claim it through the Orbio MCP (`orbio_claim_key`) or on the dashboard,
 * put it in `.env.local`, and everything under `src/examples` runs on it.
 *
 * The two extra headers are optional. OpenRouter uses them to attribute usage
 * to your app on its public rankings, which is free marketing for what you
 * build this week.
 */
const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) {
  throw new Error(
    'OPENROUTER_API_KEY is not set. Claim a key on Orbio, then copy .env.example to .env.local.',
  )
}

export const openrouter = new OpenAI({
  apiKey,
  baseURL: 'https://api.orbio.so/api/v1',
  defaultHeaders: {
    'HTTP-Referer': process.env.APP_URL ?? 'https://orbio.so/build',
    'X-Title': process.env.APP_NAME ?? 'Orbio Build Week',
  },
})

/** Raw fetch against the same base, for endpoints the SDK does not model. */
export const openrouterFetch = (path: string, init: RequestInit = {}) =>
  fetch(`https://api.orbio.so/api/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

/**
 * A sensible default. Swap freely — any model on openrouter.ai/models works,
 * and `openrouter/auto` lets the router pick per request.
 */
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4.5'
