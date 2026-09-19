import type {
  InventoryRow,
  LeakCandidate,
  SalesRow,
} from '../types.js'
import { currency, latestSalesDate, withinPreviousDays } from './utils.js'

export function findStockoutRisks(
  sales: SalesRow[],
  inventory: InventoryRow[],
): LeakCandidate[] {
  const latest = latestSalesDate(sales)
  const recent = sales.filter((row) =>
    withinPreviousDays(row.date, latest, 30),
  )

  const results: LeakCandidate[] = []

  for (const item of inventory) {
    const productSales = recent.filter((row) => row.sku === item.sku)
    if (!productSales.length) continue

    const units = productSales.reduce((sum, row) => sum + row.quantity, 0)
    const revenue = productSales.reduce(
      (sum, row) => sum + row.quantity * row.unitPrice,
      0,
    )

    const avgDailyUnits = units / 30
    if (avgDailyUnits <= 0) continue

    const daysCover = item.currentStock / avgDailyUnits

    if (daysCover >= item.leadTimeDays) continue

    const expectedUnitsDuringLeadTime = avgDailyUnits * item.leadTimeDays
    const shortageUnits = Math.max(
      0,
      expectedUnitsDuringLeadTime - item.currentStock,
    )

    const avgSellingPrice = revenue / units
    const revenueAtRisk = shortageUnits * avgSellingPrice

    if (revenueAtRisk <= 0) continue

    results.push({
      category: 'stockout_risk',
      sku: item.sku,
      productName: item.productName,
      title: `${item.productName} may stock out before replenishment`,
      evidence: [
        `${daysCover.toFixed(1)} days of stock remaining`,
        `${item.leadTimeDays} day supplier lead time`,
        `${avgDailyUnits.toFixed(1)} units sold per day over the last 30 days`,
      ],
      impact: {
        value: Math.round(revenueAtRisk),
        currency: 'NGN',
        type: 'revenue_at_risk',
      },
      confidence: 'high',
      metadata: {
        daysCover: Number(daysCover.toFixed(2)),
        leadTimeDays: item.leadTimeDays,
        shortageUnits: Number(shortageUnits.toFixed(1)),
        avgDailyUnits: Number(avgDailyUnits.toFixed(2)),
        avgSellingPrice: Math.round(avgSellingPrice),
      },
    })
  }

  return results.sort((a, b) => b.impact.value - a.impact.value)
}
