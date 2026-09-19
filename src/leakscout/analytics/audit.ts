import type {
  AuditResult,
  InventoryRow,
  SalesRow,
} from '../types.js'
import { findSalesAnomalies } from './anomalies.js'
import { findDeadInventory } from './deadStock.js'
import { findMarginLeaks } from './margins.js'
import { findStockoutRisks } from './stockout.js'
import {
  daysBetween,
  latestSalesDate,
  validateCurrency,
} from './utils.js'

export function runProfitAudit(
  sales: SalesRow[],
  inventory: InventoryRow[],
  requestedCurrency = 'NGN',
): AuditResult {
  if (!sales.length) throw new Error('No sales data supplied.')

  const currency = validateCurrency(requestedCurrency)

  const earliest = new Date(
    Math.min(...sales.map((row) => row.date.getTime())),
  )
  const latest = latestSalesDate(sales)

  const revenue = sales.reduce(
    (sum, row) => sum + row.quantity * row.unitPrice,
    0,
  )

  const candidates = [
    ...findStockoutRisks(sales, inventory, currency),
    ...findMarginLeaks(sales, currency),
    ...findDeadInventory(sales, inventory, currency),
    ...findSalesAnomalies(sales, currency),
  ].sort((a, b) => b.impact.value - a.impact.value)

  return {
    summary: {
      transactions: sales.length,
      products: new Set([
        ...sales.map((row) => row.sku),
        ...inventory.map((row) => row.sku),
      ]).size,
      periodDays: daysBetween(earliest, latest) + 1,
      revenue: Math.round(revenue),
      currency,
    },
    candidates,
  }
}
