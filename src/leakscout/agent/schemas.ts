import { z } from 'zod'

export const PrioritySelectionSchema = z.object({
  candidateId: z.string().describe(
    'Exact candidate ID returned by the investigation tool, for example C1.',
  ),
  urgency: z.enum(['today', 'this_week', 'monitor']),
})

export const AgentDecisionSchema = z.object({
  priorities: z
    .array(PrioritySelectionSchema)
    .length(3)
    .describe('Exactly three distinct verified candidates.'),
})

export type AgentDecision = z.infer<typeof AgentDecisionSchema>
