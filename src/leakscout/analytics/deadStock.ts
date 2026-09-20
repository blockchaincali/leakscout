import type {
  InventoryRow,
  LeakCandidate,
  SalesRow,
} from '../types.js'
import {
  daysBetween,
  formatMoney,
  latestSalesDate,
} from './utils.js'

export function findDeadInventory(
  sales: SalesRow[],
  inventory: InventoryRow[],
  currency: string,
): LeakCandidate[] {
  const latest = latestSalesDate(sales)
  const earliest = new Date(
    Math.min(...sales.map((row) => row.date.getTime())),
  )
  const observationDays = daysBetween(earliest, latest) + 1
  const results: LeakCandidate[] = []

  for (const item of inventory) {
    if (
      item.stockKnown === false ||
      item.unitCostKnown === false
    ) {
      continue
    }

    if (item.currentStock <= 0) continue

    const productSales = sales
      .filter((row) => row.sku === item.sku && row.quantity > 0)
      .sort((a, b) => b.date.getTime() - a.date.getTime())

    const lastSale = productSales[0]
    const daysSinceLastSale = lastSale
      ? daysBetween(lastSale.date, latest)
      : observationDays

    if (daysSinceLastSale < 45) continue

    const capitalTiedUp = item.currentStock * item.unitCost
    if (capitalTiedUp <= 0) continue

    results.push({
      category: 'dead_inventory',
      sku: item.sku,
      productName: item.productName,
      title: `${item.productName} is tying up working capital`,
      evidence: [
        lastSale
          ? `No recorded sale for ${daysSinceLastSale} days`
          : `No recorded sales during the ${observationDays}-day observation period`,
        `${item.currentStock} units currently in stock`,
        `Current unit cost is ${formatMoney(item.unitCost, currency)}`,
      ],
      impact: {
        value: Math.round(capitalTiedUp),
        currency,
        type: 'capital_tied_up',
      },
      confidence: 'high',
      metadata: {
        currentStock: item.currentStock,
        unitCost: item.unitCost,
        daysSinceLastSale,
      },
    })
  }

  return results.sort((a, b) => b.impact.value - a.impact.value)
}
