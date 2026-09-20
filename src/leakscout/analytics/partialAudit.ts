import type {
  AuditResult,
  InventoryDataQuality,
  InventoryRow,
  SalesRow,
} from '../types.js'
import { findSalesAnomalies } from './anomalies.js'
import { findInventoryExposure } from './inventoryExposure.js'
import { buildInventoryHealthInsights } from './inventoryHealth.js'
import { findMarginLeaks } from './margins.js'
import {
  daysBetween,
  latestSalesDate,
  validateCurrency,
} from './utils.js'

export function inventoryQuality(
  inventory: InventoryRow[],
): InventoryDataQuality {
  const duplicateCount = (
    values: string[],
  ) => {
    const counts = new Map<string, number>()

    for (const value of values) {
      const normalized = value.trim().toUpperCase()
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }

    return [...counts.values()].filter((count) => count > 1).length
  }

  const totalRows = inventory.length
  const stockKnown = inventory.filter((row) => row.stockKnown !== false).length
  const unitCostKnown = inventory.filter((row) => row.unitCostKnown !== false).length
  const leadTimeKnown = inventory.filter((row) => row.leadTimeKnown !== false).length
  const sellingPriceKnown = inventory.filter((row) => row.sellingPriceKnown === true).length
  const skuKnown = inventory.filter((row) => row.skuProvided !== false).length
  const barcodeValues = inventory.flatMap((row) => row.barcode ? [row.barcode] : [])
  const readinessFields = stockKnown + unitCostKnown + leadTimeKnown + sellingPriceKnown

  return {
    totalRows,
    stockKnown,
    unitCostKnown,
    leadTimeKnown,
    sellingPriceKnown,
    availabilityKnown: inventory.filter((row) => row.available !== undefined).length,
    categoryKnown: inventory.filter((row) => Boolean(row.category?.trim())).length,
    skuKnown,
    barcodeKnown: barcodeValues.length,
    duplicateSkus: duplicateCount(
      inventory.filter((row) => row.skuProvided !== false).map((row) => row.sku),
    ),
    duplicateBarcodes: duplicateCount(barcodeValues),
    readinessPercent: totalRows
      ? Math.round((readinessFields / (totalRows * 4)) * 100)
      : 0,
    stockAndCostKnown: inventory.filter(
      (row) => row.stockKnown !== false && row.unitCostKnown !== false,
    ).length,
    stockAndLeadTimeKnown: inventory.filter(
      (row) => row.stockKnown !== false && row.leadTimeKnown !== false,
    ).length,
  }
}

export function runSalesOnlyAudit(
  sales: SalesRow[],
  requestedCurrency = 'NGN',
): AuditResult {
  if (!sales.length) {
    throw new Error(
      'No sales data supplied.',
    )
  }

  const currency =
    validateCurrency(
      requestedCurrency,
    )

  const earliest = new Date(
    Math.min(
      ...sales.map(
        (row) =>
          row.date.getTime(),
      ),
    ),
  )

  const latest =
    latestSalesDate(sales)

  const revenue =
    sales.reduce(
      (sum, row) =>
        sum +
        row.quantity *
          row.unitPrice,
      0,
    )

  const candidates = [
    ...findMarginLeaks(
      sales,
      currency,
    ),
    ...findSalesAnomalies(
      sales,
      currency,
    ),
  ].sort(
    (a, b) =>
      b.impact.value -
      a.impact.value,
  )

  return {
    summary: {
      transactions:
        sales.length,

      products:
        new Set(
          sales.map(
            (row) =>
              row.sku,
          ),
        ).size,

      periodDays:
        daysBetween(
          earliest,
          latest,
        ) + 1,

      revenue:
        Math.round(
          revenue,
        ),

      currency,
      salesDataQuality: {
        totalRows: sales.length,
        unitCostKnown: sales.filter((row) => row.unitCostKnown !== false).length,
      },
    },

    candidates,
  }
}

export function runInventoryOnlyAudit(
  inventory: InventoryRow[],
  requestedCurrency = 'NGN',
): AuditResult {
  if (!inventory.length) {
    throw new Error(
      'No inventory data supplied.',
    )
  }

  const currency =
    validateCurrency(
      requestedCurrency,
    )

  const quality =
    inventoryQuality(
      inventory,
    )

  const valuation = inventory.reduce(
      (totals, item) => {
        if (
          item.stockKnown === false ||
          item.currentStock < 0
        ) {
          return totals
        }

        if (
          item.unitCostKnown !== false
        ) {
          totals.cost += item.currentStock * item.unitCost
          totals.costRows += 1
          return totals
        }

        if (
          item.sellingPriceKnown === true
        ) {
          totals.retail += item.currentStock * (item.sellingPrice ?? 0)
          totals.retailRows += 1
          return totals
        }

        return totals
      },
      { cost: 0, retail: 0, costRows: 0, retailRows: 0 },
    )

  return {
    summary: {
      transactions: 0,

      products:
        new Set(
          inventory.map(
            (row) =>
              row.sku,
          ),
        ).size,

      periodDays: 0,

      revenue: 0,

      inventoryValue: valuation.costRows ? Math.round(valuation.cost) : undefined,
      retailInventoryValue: valuation.retailRows ? Math.round(valuation.retail) : undefined,

      inventoryDataQuality:
        quality,

      currency,
    },

    candidates:
      findInventoryExposure(
        inventory,
        currency,
      ),

    inventoryInsights:
      buildInventoryHealthInsights(
        inventory,
        currency,
      ),
  }
}
