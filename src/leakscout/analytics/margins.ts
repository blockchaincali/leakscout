import type { LeakCandidate, SalesRow } from '../types.js'
import { latestSalesDate, DAY_MS } from './utils.js'

type PeriodStats = {
  units: number
  revenue: number
  cost: number
}

function stats(rows: SalesRow[]): PeriodStats {
  return rows.reduce(
    (acc, row) => {
      acc.units += row.quantity
      acc.revenue += row.quantity * row.unitPrice
      acc.cost += row.quantity * row.unitCost
      return acc
    },
    { units: 0, revenue: 0, cost: 0 },
  )
}

export function findMarginLeaks(
  sales: SalesRow[],
  currency: string,
): LeakCandidate[] {
  const latest = latestSalesDate(sales)
  const latestMs = latest.getTime()

  const skus = [...new Set(sales.map((row) => row.sku))]
  const results: LeakCandidate[] = []

  for (const sku of skus) {
    const all = sales.filter((row) => row.sku === sku)
    const productName = all[0]?.productName ?? sku

    const recentRows = all.filter((row) => {
      const diff = latestMs - row.date.getTime()
      return diff >= 0 && diff < 30 * DAY_MS
    })

    const baselineRows = all.filter((row) => {
      const diff = latestMs - row.date.getTime()
      return diff >= 30 * DAY_MS && diff < 60 * DAY_MS
    })

    const recent = stats(recentRows)
    const baseline = stats(baselineRows)

    if (recent.units <= 0 || baseline.units <= 0) continue

    const recentPrice = recent.revenue / recent.units
    const baselinePrice = baseline.revenue / baseline.units
    const recentCost = recent.cost / recent.units
    const baselineCost = baseline.cost / baseline.units

    const recentMargin = recentPrice - recentCost
    const baselineMargin = baselinePrice - baselineCost

    if (baselineMargin <= 0) continue

    const marginDropPct =
      ((baselineMargin - recentMargin) / baselineMargin) * 100

    const costIncreasePct =
      baselineCost > 0
        ? ((recentCost - baselineCost) / baselineCost) * 100
        : 0

    const priceIncreasePct =
      baselinePrice > 0
        ? ((recentPrice - baselinePrice) / baselinePrice) * 100
        : 0

    if (marginDropPct < 15 || costIncreasePct <= priceIncreasePct) continue

    const monthlyProfitLeak =
      Math.max(0, baselineMargin - recentMargin) * recent.units

    results.push({
      category: 'margin_compression',
      sku,
      productName,
      title: `${productName} margin has compressed`,
      evidence: [
        `Unit margin fell ${marginDropPct.toFixed(1)}%`,
        `Unit cost changed ${costIncreasePct.toFixed(1)}%`,
        `Selling price changed ${priceIncreasePct.toFixed(1)}%`,
        `${Math.round(recent.units)} units sold in the recent 30-day period`,
      ],
      impact: {
        value: Math.round(monthlyProfitLeak),
        currency,
        type: 'monthly_profit_leak',
      },
      confidence: 'high',
      metadata: {
        baselineMargin: Math.round(baselineMargin),
        recentMargin: Math.round(recentMargin),
        baselinePrice: Math.round(baselinePrice),
        recentPrice: Math.round(recentPrice),
        baselineCost: Math.round(baselineCost),
        recentCost: Math.round(recentCost),
        marginDropPct: Number(marginDropPct.toFixed(1)),
      },
    })
  }

  return results.sort((a, b) => b.impact.value - a.impact.value)
}
