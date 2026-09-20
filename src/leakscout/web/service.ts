import type {
  AuditResult,
  InventoryRow,
  LeakCandidate,
  SalesRow,
} from '../types.js'
import { runProfitAudit } from '../analytics/audit.js'
import {
  runInventoryOnlyAudit,
  runSalesOnlyAudit,
} from '../analytics/partialAudit.js'
import type { LeakScoutReport } from '../agent/leakScout.js'
import { InputError } from '../errors.js'

export type DataMode =
  | 'full'
  | 'sales_only'
  | 'inventory_only'

export type LeakScoutExecution = {
  audit: AuditResult
  report: LeakScoutReport
  dataMode: DataMode
  agentUsed: boolean
  agentStatus:
    | 'completed'
    | 'not_needed'
    | 'fallback'
    | 'insufficient_context'
  poweredBy: 'Orbio'
  currencySemantics: 'source_accounting_currency'
  coverage: {
    salesProvided: boolean
    inventoryProvided: boolean
    limitations: string[]
  }
}

export type LeakScoutExecutionOptions = {
  runAgent?: (
    audit: AuditResult,
    signal: AbortSignal,
  ) => Promise<LeakScoutReport>
}

function actionFor(
  candidate: LeakCandidate,
): string {
  switch (candidate.category) {
    case 'stockout_risk':
      return 'Reorder promptly and review the reorder threshold using recent sales velocity and supplier lead time.'

    case 'margin_compression':
      return 'Review selling price and supplier terms to restore healthy unit economics.'

    case 'dead_inventory':
      return 'Pause further reordering and consider clearance, bundling or promotion to recover working capital.'

    case 'sales_anomaly':
      return 'Investigate availability, pricing, promotions and demand changes before changing inventory commitments.'

    case 'inventory_exposure':
      return 'Review recent movement and demand before increasing this inventory position.'
  }
}

function monitorFor(
  candidate: LeakCandidate,
): string {
  const product =
    candidate.productName ??
    candidate.sku ??
    'this product'

  switch (candidate.category) {
    case 'stockout_risk':
      return `Monitor ${product} inventory cover against supplier lead time.`

    case 'margin_compression':
      return `Monitor ${product} unit margin after pricing or supplier changes.`

    case 'dead_inventory':
      return `Monitor whether ${product} inventory begins moving before any reorder.`

    case 'sales_anomaly':
      return `Monitor ${product} sales against its previous run rate.`

    case 'inventory_exposure':
      return `Monitor ${product} inventory movement before reordering.`
  }
}

function urgencyFor(
  candidate: LeakCandidate,
): 'today' | 'this_week' | 'monitor' {
  switch (candidate.category) {
    case 'stockout_risk':
      return 'today'

    case 'margin_compression':
    case 'sales_anomaly':
    case 'dead_inventory':
      return 'this_week'

    case 'inventory_exposure':
      return 'monitor'
  }
}

function buildFallbackReport(
  audit: AuditResult,
  mode: DataMode,
): LeakScoutReport {
  const selected =
    audit.candidates.slice(0, 3)

  let headline =
    'Verified business signals detected'

  let executiveSummary =
    'LeakScout analysed the supplied data and returned deterministic findings.'

  if (mode === 'inventory_only') {
    const quality =
      audit.summary
        .inventoryDataQuality

    if (
      quality &&
      quality.stockKnown === 0
    ) {
      headline =
        'Inventory imported — stock quantities are untracked'

      executiveSummary =
        `LeakScout successfully mapped ${quality.totalRows} products, but this export does not contain usable stock quantities. It will not fabricate inventory exposure from unknown stock. Add tracked quantities or sales data for a deeper investigation.`
    } else if (
      quality &&
      quality.unitCostKnown === 0 &&
      quality.sellingPriceKnown > 0
    ) {
      headline =
        selected.length === 0
          ? 'Inventory imported — cost basis unavailable'
          : `${selected.length} retail inventory exposures identified`

      executiveSummary =
        'Selling prices were found but unit costs were not. Any inventory valuation shown is therefore retail-value exposure, not capital tied up or confirmed financial leakage.'
    } else {
      headline =
        selected.length === 0
          ? 'No measurable inventory exposure detected'
          : `${selected.length} inventory exposures identified`

      executiveSummary =
        'This inventory-only audit measures inventory-value concentration. Sales history was not supplied, so these holdings are not being labelled as dead stock or confirmed financial leakage.'
    }
  }

  if (mode === 'sales_only') {
    headline =
      selected.length === 0
        ? 'No material sales signals detected'
        : `${selected.length} sales and margin signals identified`

    executiveSummary =
      'This sales-only audit checks margin compression and sales anomalies. Inventory data was not supplied, so stockout and dead-inventory risks were not evaluated.'
  }

  if (
    mode === 'full' &&
    selected.length === 0
  ) {
    headline =
      'No material profit leaks detected'

    executiveSummary =
      'LeakScout analysed the available transaction and inventory data and found no signals above its current detection thresholds.'
  }

  if (
    mode === 'full' &&
    selected.length > 0
  ) {
    headline =
      `${selected.length} verified issue${selected.length === 1 ? '' : 's'} need attention`

    executiveSummary =
      'LeakScout found verified operational signals. Agent prioritization was unavailable, so deterministic findings are shown instead.'
  }

  return {
    headline,
    executiveSummary,
    priorities: selected.map(
      (candidate) => ({
        candidate: {
          ...candidate,
          id: `F-${candidate.category}-${candidate.sku ?? 'business'}`,
        },
        reasoning:
          candidate.evidence.join('; '),
        recommendedAction:
          actionFor(candidate),
        urgency: urgencyFor(candidate),
      }),
    ),
    actionPlan: {
      today: selected
        .filter(
          (candidate) =>
            urgencyFor(candidate) ===
            'today',
        )
        .map(actionFor)
        .slice(0, 3),

      thisWeek: selected
        .filter(
          (candidate) =>
            urgencyFor(candidate) ===
            'this_week',
        )
        .map(actionFor)
        .slice(0, 3),

      monitor:
        mode === 'inventory_only' &&
        audit.inventoryInsights?.length
          ? audit.inventoryInsights
              .slice(0, 3)
              .map(
                (insight) =>
                  insight.action,
              )
          : selected
              .map(monitorFor)
              .slice(0, 3),
    },
    model:
      mode === 'full'
        ? 'deterministic-fallback'
        : 'deterministic-partial',
    toolCalls: [],
  }
}

function getCoverage(
  mode: DataMode,
  audit: AuditResult,
) {
  if (mode === 'full') {
    const limitations: string[] = []
    const inventoryQuality = audit.summary.inventoryDataQuality
    const salesQuality = audit.summary.salesDataQuality

    if (salesQuality && salesQuality.unitCostKnown < salesQuality.totalRows) {
      limitations.push(
        `Unit cost is available for ${salesQuality.unitCostKnown} of ${salesQuality.totalRows} sales rows; margin analysis excludes rows without cost.`,
      )
    }

    if (inventoryQuality) {
      if (inventoryQuality.stockKnown < inventoryQuality.totalRows) {
        limitations.push(
          `Usable stock quantities were found for ${inventoryQuality.stockKnown} of ${inventoryQuality.totalRows} products.`,
        )
      }

      if (inventoryQuality.unitCostKnown < inventoryQuality.totalRows) {
        limitations.push(
          `Unit costs were found for ${inventoryQuality.unitCostKnown} of ${inventoryQuality.totalRows} products.`,
        )
      }

      if (inventoryQuality.leadTimeKnown < inventoryQuality.totalRows) {
        limitations.push(
          `Supplier lead times were found for ${inventoryQuality.leadTimeKnown} of ${inventoryQuality.totalRows} products.`,
        )
      }
    }

    return {
      salesProvided: true,
      inventoryProvided: true,
      limitations,
    }
  }

  if (mode === 'sales_only') {
    return {
      salesProvided: true,
      inventoryProvided: false,
      limitations: [
        'Inventory data was not supplied, so stockout risk, dead inventory and inventory-value exposure were not evaluated.',
      ],
    }
  }

  const limitations = [
    'Sales data was not supplied, so stockout risk, margin compression, sales anomalies and dead-stock age could not be verified.',
  ]

  const quality =
    audit.summary
      .inventoryDataQuality

  if (quality) {
    if (
      quality.stockKnown <
      quality.totalRows
    ) {
      limitations.push(
        `Usable stock quantities were found for ${quality.stockKnown} of ${quality.totalRows} products.`,
      )
    }

    if (
      quality.unitCostKnown <
      quality.totalRows
    ) {
      limitations.push(
        `Unit costs were found for ${quality.unitCostKnown} of ${quality.totalRows} products.`,
      )
    }

    if (
      quality.leadTimeKnown <
      quality.totalRows
    ) {
      limitations.push(
        `Supplier lead times were found for ${quality.leadTimeKnown} of ${quality.totalRows} products.`,
      )
    }
  }

  return {
    salesProvided: false,
    inventoryProvided: true,
    limitations,
  }
}

async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
): Promise<T> {
  const controller = new AbortController()
  let timer:
    | ReturnType<typeof setTimeout>
    | undefined

  try {
    return await Promise.race([
      task(controller.signal),
      new Promise<T>(
        (_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(
              new Error(
                'Orbio investigation timed out.',
              ),
            )
          }, milliseconds)
        },
      ),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const MAX_CONCURRENT_INVESTIGATIONS = 3
let activeInvestigations = 0

export async function executeLeakScout(
  sales: SalesRow[],
  inventory: InventoryRow[],
  currency: string,
  options: LeakScoutExecutionOptions = {},
): Promise<LeakScoutExecution> {
  const hasSales = sales.length > 0
  const hasInventory =
    inventory.length > 0

  if (!hasSales && !hasInventory) {
    throw new InputError(
      'Add sales data, inventory data, or both.',
    )
  }

  const mode: DataMode =
    hasSales && hasInventory
      ? 'full'
      : hasSales
        ? 'sales_only'
        : 'inventory_only'

  const audit =
    mode === 'full'
      ? runProfitAudit(
          sales,
          inventory,
          currency,
        )
      : mode === 'sales_only'
        ? runSalesOnlyAudit(
            sales,
            currency,
          )
        : runInventoryOnlyAudit(
            inventory,
            currency,
          )

  const coverage =
    getCoverage(
      mode,
      audit,
    )

  /*
   * Partial datasets still receive a useful deterministic audit,
   * but we deliberately do not spend Orbio inference without
   * enough context for the full investigation.
   */
  if (mode !== 'full') {
    return {
      audit,
      report: buildFallbackReport(
        audit,
        mode,
      ),
      dataMode: mode,
      agentUsed: false,
      agentStatus:
        'insufficient_context',
      poweredBy: 'Orbio',
      currencySemantics: 'source_accounting_currency',
      coverage,
    }
  }

  if (audit.candidates.length < 3) {
    return {
      audit,
      report: buildFallbackReport(
        audit,
        mode,
      ),
      dataMode: mode,
      agentUsed: false,
      agentStatus: 'not_needed',
      poweredBy: 'Orbio',
      currencySemantics: 'source_accounting_currency',
      coverage,
    }
  }

  let investigationSlotAcquired = false

  try {
    if (activeInvestigations >= MAX_CONCURRENT_INVESTIGATIONS) {
      throw new Error('Orbio investigation capacity is currently full.')
    }

    activeInvestigations += 1
    investigationSlotAcquired = true
    const runAgent = options.runAgent ??
      (await import('../agent/leakScout.js')).runLeakScoutAgent
    const report = await withTimeout(
      (signal) => runAgent(audit, signal),
      25_000,
    )

    return {
      audit,
      report,
      dataMode: mode,
      agentUsed: true,
      agentStatus: 'completed',
      poweredBy: 'Orbio',
      currencySemantics: 'source_accounting_currency',
      coverage,
    }
  } catch (error) {
    void error
    console.error('Orbio investigation failed; deterministic fallback activated.')

    return {
      audit,
      report: buildFallbackReport(
        audit,
        mode,
      ),
      dataMode: mode,
      agentUsed: false,
      agentStatus: 'fallback',
      poweredBy: 'Orbio',
      currencySemantics: 'source_accounting_currency',
      coverage,
    }
  } finally {
    if (investigationSlotAcquired) {
      activeInvestigations = Math.max(0, activeInvestigations - 1)
    }
  }
}
