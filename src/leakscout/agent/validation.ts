import { z } from 'zod'
import type { LeakCategory } from '../types.js'
import {
  ALL_LEAK_CATEGORIES,
  ScoutToolArgsSchema,
  type AgentDecision,
} from './schemas.js'

export { ALL_LEAK_CATEGORIES }

export function parseInvestigationCategories(raw: string): LeakCategory[] {
  const schema = z.object({
    categories: z.array(z.enum(ALL_LEAK_CATEGORIES)).min(1),
  })

  try {
    return schema.parse(JSON.parse(raw || '{}')).categories
  } catch {
    return [...ALL_LEAK_CATEGORIES]
  }
}

export function parseScoutToolArgs(raw: string) {
  return ScoutToolArgsSchema.parse(JSON.parse(raw || '{}'))
}

export function validateCandidateIds<T extends { id: string }>(
  candidates: T[],
  candidateIds: string[],
  minimum = 3,
): T[] {
  if (candidateIds.length < minimum) {
    throw new Error(`Scout must select at least ${minimum} verified candidates.`)
  }

  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error('Scout selected a duplicate candidate ID.')
  }

  return candidateIds.map((id) => {
    const candidate = candidates.find((item) => item.id === id)
    if (!candidate) throw new Error(`Scout selected unknown candidate: ${id}`)
    return candidate
  })
}

export function validatePrioritySelections<T extends { id: string }>(
  candidates: T[],
  selections: AgentDecision['priorities'],
  inspectedCandidateIds: ReadonlySet<string>,
): Array<{ candidate: T; urgency: AgentDecision['priorities'][number]['urgency'] }> {
  if (selections.length !== 3) {
    throw new Error(`Expected exactly 3 priorities, received ${selections.length}.`)
  }

  const seen = new Set<string>()

  return selections.map((selection) => {
    if (seen.has(selection.candidateId)) {
      throw new Error(`Duplicate candidate selected: ${selection.candidateId}`)
    }

    seen.add(selection.candidateId)
    const candidate = candidates.find((item) => item.id === selection.candidateId)

    if (!candidate) {
      throw new Error(`Agent selected unknown candidate: ${selection.candidateId}`)
    }

    if (!inspectedCandidateIds.has(candidate.id)) {
      throw new Error(`Agent selected candidate it did not inspect: ${candidate.id}`)
    }

    return { candidate, urgency: selection.urgency }
  })
}
