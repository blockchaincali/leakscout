import { config } from 'dotenv'

// Load the runtime configuration before resolving model roles. The same
// centralized dotenv behavior is used by the OpenRouter client and assistants.
config({ path: ['.env.local', '.env'], quiet: true })

export const LEAKSCOUT_MODEL_DEFAULTS = {
  scout: 'google/gemini-3.8-flash',
  investigator: 'anthropic/claude-sonnet-5',
  critic: 'openai/gpt-6-astra',
  brief: 'openai/gpt-6-astra',
  chat: 'anthropic/claude-sonnet-5',
  publicAssistant: 'google/gemini-3.8-flash',
} as const

export function resolveLeakScoutModels(
  environment: Record<string, string | undefined> = process.env,
) {
  const configured = (name: string, fallback: string) =>
    environment[name]?.trim() || fallback

  return {
    scout: configured('LEAKSCOUT_SCOUT_MODEL', LEAKSCOUT_MODEL_DEFAULTS.scout),
    investigator: configured(
      'LEAKSCOUT_INVESTIGATOR_MODEL',
      LEAKSCOUT_MODEL_DEFAULTS.investigator,
    ),
    critic: configured('LEAKSCOUT_CRITIC_MODEL', LEAKSCOUT_MODEL_DEFAULTS.critic),
    brief: configured('LEAKSCOUT_BRIEF_MODEL', LEAKSCOUT_MODEL_DEFAULTS.brief),
    chat: configured('LEAKSCOUT_CHAT_MODEL', LEAKSCOUT_MODEL_DEFAULTS.chat),
    publicAssistant: configured(
      'LEAKSCOUT_PUBLIC_ASSISTANT_MODEL',
      LEAKSCOUT_MODEL_DEFAULTS.publicAssistant,
    ),
  } as const
}

export const LEAKSCOUT_MODELS = resolveLeakScoutModels()

const legacyFallback =
  process.env.OPENROUTER_MODEL?.trim() || 'anthropic/claude-sonnet-4.5'

/** Backwards-compatible default for non-LeakScout starter examples. */
export const DEFAULT_MODEL = legacyFallback

export const LEAKSCOUT_TIMEOUTS_MS = {
  scout: 30_000,
  investigator: 60_000,
  critic: 60_000,
  brief: 45_000,
  chat: 45_000,
  publicAssistant: 30_000,
} as const
