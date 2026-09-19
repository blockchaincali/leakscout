import type {
  AuditResult,
  InventoryRow,
  SalesRow,
} from '../types.js'
import { findSalesAnomalies } from './anomalies.js'
import { findDeadInventory } from './deadStock.js'
import { findMarginLeaks } from './margins.js'
import { findStockoutRisks } from './stockout.js'
import { daysBetween, latestSalesDate } from './utils.js'

export function runProfitAudit(
  sales: SalesRow[],
  inventory: InventoryRow[],
): AuditResult {
  if (!sales.length) throw new Error('No sales data supplied.')

  const earliest = new Date(
    Math.min(...sales.map((row) => row.date.getTime())),
  )
  const latest = latestSalesDate(sales)

  const revenue = sales.reduce(
    (sum, row) => sum + row.quantity * row.unitPrice,
    0,
  )

  const candidates = [
    ...findStockoutRisks(sales, inventory),
    ...findMarginLeaks(sales),
    ...findDeadInventory(sales, inventory),
    ...findSalesAnomalies(sales),
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
    },
    candidates,
  }
}
