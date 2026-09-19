import type { LeakCandidate, SalesRow } from '../types.js'
import {
  DAY_MS,
  formatMoney,
  latestSalesDate,
} from './utils.js'

export function findSalesAnomalies(
  sales: SalesRow[],
  currency: string,
): LeakCandidate[] {
  const latest = latestSalesDate(sales)
  const latestMs = latest.getTime()
  const skus = [...new Set(sales.map((row) => row.sku))]
  const results: LeakCandidate[] = []

  for (const sku of skus) {
    const productRows = sales.filter((row) => row.sku === sku)
    const productName = productRows[0]?.productName ?? sku

    const recentRows = productRows.filter((row) => {
      const diff = latestMs - row.date.getTime()
      return diff >= 0 && diff < 7 * DAY_MS
    })

    const priorRows = productRows.filter((row) => {
      const diff = latestMs - row.date.getTime()
      return diff >= 7 * DAY_MS && diff < 35 * DAY_MS
    })

    const recentRevenue = recentRows.reduce(
      (sum, row) => sum + row.quantity * row.unitPrice,
      0,
    )

    const priorRevenue = priorRows.reduce(
      (sum, row) => sum + row.quantity * row.unitPrice,
      0,
    )

    if (priorRevenue <= 0) continue

    const expectedRecentRevenue = (priorRevenue / 28) * 7
    if (expectedRecentRevenue <= 0) continue

    const declinePct =
      ((expectedRecentRevenue - recentRevenue) /
        expectedRecentRevenue) *
      100

    if (declinePct < 25) continue

    const revenueDecline = expectedRecentRevenue - recentRevenue

    results.push({
      category: 'sales_anomaly',
      sku,
      productName,
      title: `${productName} sales have dropped unusually`,
      evidence: [
        `Recent 7-day revenue is ${declinePct.toFixed(1)}% below its previous run rate`,
        `Expected 7-day revenue: ${formatMoney(expectedRecentRevenue, currency)}`,
        `Actual 7-day revenue: ${formatMoney(recentRevenue, currency)}`,
      ],
      impact: {
        value: Math.round(revenueDecline),
        currency,
        type: 'revenue_decline',
      },
      confidence: declinePct >= 40 ? 'high' : 'medium',
      metadata: {
        declinePct: Number(declinePct.toFixed(1)),
        expectedRecentRevenue: Math.round(expectedRecentRevenue),
        recentRevenue: Math.round(recentRevenue),
      },
    })
  }

  return results.sort((a, b) => b.impact.value - a.impact.value)
}
