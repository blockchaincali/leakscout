import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LEAKSCOUT_MODEL_DEFAULTS,
  LEAKSCOUT_MODELS,
  resolveLeakScoutModels,
} from '../../lib/modelConfig.js'
import type { AuditResult, LeakCandidate } from '../types.js'
import {
  LeakScoutPipelineError,
  runLeakScoutAgent,
  type AgentCompletion,
  type AgentCompletionRequest,
} from '../agent/leakScout.js'
import { executeLeakScout } from '../web/service.js'

const candidate = (
  id: number,
  category: LeakCandidate['category'],
): LeakCandidate => ({
  category,
  sku: `SKU-${id}`,
  productName: `Product ${id}`,
  title: `Verified ${category.replaceAll('_', ' ')} signal ${id}`,
  evidence: ['Verified movement and operational records support this signal.'],
  impact: {
    value: id * 100,
    currency: 'NGN',
    type: category === 'stockout_risk'
      ? 'revenue_at_risk'
      : category === 'margin_compression'
        ? 'monthly_profit_leak'
        : category === 'dead_inventory'
          ? 'capital_tied_up'
          : category === 'sales_anomaly'
            ? 'revenue_decline'
            : 'inventory_value_exposure',
  },
  confidence: 'high',
  metadata: { verifiedMeasure: id * 10 },
})

const audit: AuditResult = {
  summary: {
    transactions: 28,
    products: 4,
    periodDays: 60,
    revenue: 52_400,
    inventoryValue: 12_000,
    currency: 'NGN',
    inventoryDataQuality: {
      totalRows: 4,
      stockKnown: 4,
      unitCostKnown: 4,
      leadTimeKnown: 4,
      sellingPriceKnown: 0,
      availabilityKnown: 0,
      categoryKnown: 0,
      skuKnown: 4,
      barcodeKnown: 0,
      duplicateSkus: 0,
      duplicateBarcodes: 0,
      readinessPercent: 75,
      stockAndCostKnown: 4,
      stockAndLeadTimeKnown: 4,
    },
  },
  candidates: [
    candidate(1, 'stockout_risk'),
    candidate(2, 'margin_compression'),
    candidate(3, 'sales_anomaly'),
    candidate(4, 'dead_inventory'),
  ],
}

function report(ids: string[], changes: Partial<{
  headline: string
  executiveSummary: string
  firstWhy: string
  firstAction: string
}> = {}) {
  return {
    headline: changes.headline ?? 'Three verified priorities need attention',
    executiveSummary: changes.executiveSummary ?? 'These signals have different operational consequences.',
    priorities: ids.map((candidateId, index) => ({
      candidateId,
      urgency: index === 0 ? 'today' : index === 1 ? 'this_week' : 'monitor',
      whyItMatters: index === 0 && changes.firstWhy
        ? changes.firstWhy
        : 'This verified signal can affect normal operating decisions.',
      reasoning: 'The evidence supports addressing this before lower-priority findings.',
      recommendedAction: index === 0 && changes.firstAction
        ? changes.firstAction
        : 'Review the source records that support this signal.',
      checksToPerform: [
        'Confirm the records and dates in the relevant business system.',
        'Compare the finding with the current operating process.',
      ],
      watchFor: ['Watch for the verified signal to persist in the next review.'],
      assumptionsOrUnknowns: ['The supplied data does not establish the underlying cause.'],
    })),
  }
}

function scoutCall(candidateIds = ['C1', 'C2', 'C3']) {
  return {
    content: null,
    model: 'actual/scout-model',
    toolCalls: [{
      id: 'tool-1',
      name: 'inspect_verified_leaks',
      arguments: JSON.stringify({
        categories: ['stockout_risk', 'margin_compression', 'sales_anomaly'],
        candidateIds,
        evidenceAreas: ['operational urgency', 'verified financial exposure'],
      }),
    }],
  }
}

function mockedPipeline(options: {
  investigator?: ReturnType<typeof report>
  critic?: ReturnType<typeof report>
  failAt?: AgentCompletionRequest['role']
  scoutIds?: string[]
} = {}) {
  const requests: AgentCompletionRequest[] = []
  const complete: AgentCompletion = async (request) => {
    requests.push(request)
    if (request.role === options.failAt) throw new Error(`${request.role} unavailable`)
    if (request.role === 'scout') return scoutCall(options.scoutIds)
    return {
      model: `actual/${request.role}-model`,
      content: JSON.stringify(
        request.role === 'investigator'
          ? options.investigator ?? report(['C1', 'C2', 'C3'])
          : options.critic ?? report(['C1', 'C2', 'C3']),
      ),
    }
  }
  return { requests, complete }
}

test('full investigation routes scout, investigator and critic to their configured models', async () => {
  const { requests, complete } = mockedPipeline({
    critic: report(['C3', 'C1', 'C2']),
  })
  const result = await runLeakScoutAgent(audit, undefined, { complete })

  assert.deepEqual(requests.map((request) => [request.role, request.model]), [
    ['scout', LEAKSCOUT_MODELS.scout],
    ['investigator', LEAKSCOUT_MODELS.investigator],
    ['critic', LEAKSCOUT_MODELS.critic],
  ])
  assert.deepEqual(result.priorities.map((priority) => priority.candidate.id), ['C3', 'C1', 'C2'])
  assert.deepEqual(result.modelTrace, [
    { role: 'scout', model: 'actual/scout-model' },
    { role: 'investigator', model: 'actual/investigator-model' },
    { role: 'critic', model: 'actual/critic-model' },
  ])
  assert.deepEqual(result.toolCalls, ['inspect_verified_leaks'])
  assert.equal(result.provider, 'Orbio')
  assert.equal(result.priorities[0].candidate.impact.value, audit.candidates[2].impact.value)
  assert.equal(result.priorities[0].checksToPerform.length, 2)
  assert.equal(result.actionPlan.today.length, 1)
  assert.equal(result.actionPlan.monitor.length, 3)
})

test('role defaults are distinct where appropriate and legacy OPENROUTER_MODEL cannot collapse them', () => {
  const models = resolveLeakScoutModels({ OPENROUTER_MODEL: 'legacy/single-model' })
  assert.deepEqual(models, LEAKSCOUT_MODEL_DEFAULTS)
  assert.deepEqual(
    resolveLeakScoutModels({
      LEAKSCOUT_SCOUT_MODEL: 'custom/scout',
      OPENROUTER_MODEL: 'legacy/single-model',
    }),
    { ...models, scout: 'custom/scout' },
  )
})

test('critic receives the investigator draft and can correct unsupported causal claims', async () => {
  const { requests, complete } = mockedPipeline({
    investigator: report(['C1', 'C2', 'C3'], {
      firstWhy: 'Customers stopped buying because the supplier caused the decline.',
    }),
    critic: report(['C1', 'C2', 'C3'], {
      firstWhy: 'The signal warrants a prompt check; the data does not show why it occurred.',
    }),
  })
  const result = await runLeakScoutAgent(audit, undefined, { complete })

  const criticRequest = requests.find((request) => request.role === 'critic')
  const criticPayload = JSON.parse(String(criticRequest?.messages[1]?.content))
  assert.match(criticPayload.investigatorDraft.priorities[0].whyItMatters, /Customers stopped buying/)
  assert.doesNotMatch(result.priorities[0].whyItMatters, /Customers stopped buying/)
  assert.deepEqual(result.modelTrace.map((entry) => entry.role), ['scout', 'investigator', 'critic'])
})

test('critic candidate IDs and unsupported numbers are rejected in favor of a grounded investigator draft', async () => {
  for (const invalidDraft of [
    report(['C99', 'C1', 'C2']),
    report(['C1', 'C2', 'C3'], { firstWhy: 'This creates 999 units of exposure.' }),
  ]) {
    const { complete } = mockedPipeline({ critic: invalidDraft })
    const result = await runLeakScoutAgent(audit, undefined, { complete })
    assert.deepEqual(result.priorities.map((priority) => priority.candidate.id), ['C1', 'C2', 'C3'])
    assert.deepEqual(result.modelTrace.map((entry) => entry.role), ['scout', 'investigator'])
    assert.equal(result.priorities[0].candidate.impact.value, 100)
    assert.doesNotMatch(JSON.stringify(result), /999/)
  }
})

test('scout rejects unknown candidate IDs and never forwards them to investigation', async () => {
  const { complete } = mockedPipeline({ scoutIds: ['C1', 'C2', 'C999'] })
  await assert.rejects(
    runLeakScoutAgent(audit, undefined, { complete }),
    (error: unknown) => {
      assert.ok(error instanceof LeakScoutPipelineError)
      assert.equal(error.modelTrace.length, 0)
      return true
    },
  )
})

test('scout failure has no false completed model trace', async () => {
  const { complete } = mockedPipeline({ failAt: 'scout' })
  await assert.rejects(
    runLeakScoutAgent(audit, undefined, { complete }),
    (error: unknown) => {
      assert.ok(error instanceof LeakScoutPipelineError)
      assert.deepEqual(error.modelTrace, [])
      return true
    },
  )
})

test('investigator failure retains only the successfully completed scout trace', async () => {
  const { complete } = mockedPipeline({ failAt: 'investigator' })
  await assert.rejects(
    runLeakScoutAgent(audit, undefined, { complete }),
    (error: unknown) => {
      assert.ok(error instanceof LeakScoutPipelineError)
      assert.deepEqual(error.modelTrace, [{ role: 'scout', model: 'actual/scout-model' }])
      assert.deepEqual(error.toolCalls, ['inspect_verified_leaks'])
      return true
    },
  )
})

test('critic failure uses the locally grounded investigator result without a critic trace', async () => {
  const { complete } = mockedPipeline({ failAt: 'critic' })
  const result = await runLeakScoutAgent(audit, undefined, { complete })
  assert.deepEqual(result.modelTrace.map((entry) => entry.role), ['scout', 'investigator'])
  assert.equal(result.priorities.length, 3)
})

test('unsafe investigator draft is rejected when the critic also fails', async () => {
  const { complete } = mockedPipeline({
    failAt: 'critic',
    investigator: report(['C1', 'C2', 'C3'], { firstWhy: 'The supplier delay caused the shortage.' }),
  })
  await assert.rejects(
    runLeakScoutAgent(audit, undefined, { complete }),
    (error: unknown) => {
      assert.ok(error instanceof LeakScoutPipelineError)
      assert.deepEqual(error.modelTrace.map((entry) => entry.role), ['scout', 'investigator'])
      assert.doesNotMatch(error.modelTrace.map((entry) => entry.role).join(','), /critic/)
      return true
    },
  )
})

test('execution falls back deterministically and exposes only completed partial stages', async () => {
  const sales = [
    { date: new Date('2026-01-01T00:00:00Z'), sku: 'SKU-1', productName: 'Widget', quantity: 10, unitPrice: 10, unitCost: 5 },
    { date: new Date('2026-02-10T00:00:00Z'), sku: 'SKU-1', productName: 'Widget', quantity: 400, unitPrice: 10, unitCost: 5 },
    { date: new Date('2026-03-01T00:00:00Z'), sku: 'SKU-1', productName: 'Widget', quantity: 10, unitPrice: 10, unitCost: 8 },
  ]
  const inventory = [
    { sku: 'SKU-1', productName: 'Widget', currentStock: 1, unitCost: 8, leadTimeDays: 10 },
    { sku: 'OLD', productName: 'Old stock', currentStock: 20, unitCost: 50, leadTimeDays: 5 },
  ]
  const execution = await executeLeakScout(sales, inventory, 'USD', {
    runAgent: async () => {
      throw new LeakScoutPipelineError(
        'Investigator unavailable',
        [{ role: 'scout', model: LEAKSCOUT_MODELS.scout }],
        ['inspect_verified_leaks'],
      )
    },
  })

  assert.equal(execution.agentStatus, 'fallback')
  assert.equal(execution.agentUsed, true)
  assert.equal(execution.report.model, 'deterministic-fallback')
  assert.deepEqual(execution.report.modelTrace, [{
    role: 'scout',
    model: LEAKSCOUT_MODELS.scout,
  }])
  assert.deepEqual(execution.report.toolCalls, ['inspect_verified_leaks'])
})
