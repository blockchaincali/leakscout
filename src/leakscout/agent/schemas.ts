import { z } from 'zod'

export const ALL_LEAK_CATEGORIES = [
  'stockout_risk',
  'margin_compression',
  'dead_inventory',
  'sales_anomaly',
  'inventory_exposure',
] as const

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

export const ScoutToolArgsSchema = z.object({
  categories: z.array(z.enum(ALL_LEAK_CATEGORIES)).min(1).max(5),
  candidateIds: z.array(z.string().trim().min(1).max(100)).min(3).max(15),
  evidenceAreas: z.array(z.string().trim().min(1).max(180)).min(1).max(6),
}).strict()

export const InvestigationPrioritySchema = z.object({
  candidateId: z.string().trim().min(1).max(100),
  urgency: z.enum(['today', 'this_week', 'monitor']),
  whyItMatters: z.string().trim().min(1).max(900),
  reasoning: z.string().trim().min(1).max(1_000),
  recommendedAction: z.string().trim().min(1).max(1_000),
  checksToPerform: z.array(z.string().trim().min(1).max(350)).min(2).max(4),
  watchFor: z.array(z.string().trim().min(1).max(350)).min(1).max(3),
  assumptionsOrUnknowns: z.array(z.string().trim().min(1).max(350)).min(1).max(4),
}).strict()

export const InvestigationReportSchema = z.object({
  headline: z.string().trim().min(1).max(240),
  executiveSummary: z.string().trim().min(1).max(1_000),
  priorities: z.array(InvestigationPrioritySchema).length(3),
}).strict()

export type AgentDecision = z.infer<typeof AgentDecisionSchema>
export type ScoutToolArgs = z.infer<typeof ScoutToolArgsSchema>
export type InvestigationReport = z.infer<typeof InvestigationReportSchema>
