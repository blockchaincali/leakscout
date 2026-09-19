import type {
  InventoryRow,
  LeakCandidate,
  SalesRow,
} from '../types.js'
import { daysBetween, latestSalesDate } from './utils.js'

export function findDeadInventory(
  sales: SalesRow[],
  inventory: InventoryRow[],
): LeakCandidate[] {
  const latest = latestSalesDate(sales)
  const results: LeakCandidate[] = []

  for (const item of inventory) {
    if (item.currentStock <= 0) continue

    const productSales = sales
      .filter((row) => row.sku === item.sku && row.quantity > 0)
      .sort((a, b) => b.date.getTime() - a.date.getTime())

    const lastSale = productSales[0]
    const daysSinceLastSale = lastSale
      ? daysBetween(lastSale.date, latest)
      : 999

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
          : 'No recorded sales in the dataset',
        `${item.currentStock} units currently in stock`,
        `Current unit cost is ₦${Math.round(item.unitCost).toLocaleString('en-NG')}`,
      ],
      impact: {
        value: Math.round(capitalTiedUp),
        currency: 'NGN',
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
