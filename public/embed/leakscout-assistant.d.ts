export function buildRequestPayload(
  mode: 'public' | 'merchant',
  question: string,
  history?: Array<{ role: string; content: string }>,
  maxHistory?: number,
): { question: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> }

export function normalizeResponse(
  mode: 'public' | 'merchant',
  payload: unknown,
): { answer: string; poweredBy: boolean; inferenceUsed: boolean }

export const LEAKSCOUT_ASSISTANT_VERSION: string
