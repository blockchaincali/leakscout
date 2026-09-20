import type {
  InventoryRow,
  LeakCandidate,
} from '../types.js'
import { formatMoney } from './utils.js'

export function findInventoryExposure(
  inventory: InventoryRow[],
  currency: string,
): LeakCandidate[] {
  const valued = inventory
    .filter(
      (item) =>
        item.stockKnown !== false &&
        item.currentStock > 0,
    )
    .map((item) => {
      if (
        item.unitCostKnown !== false &&
        item.unitCost > 0
      ) {
        return {
          item,
          basis: 'cost' as const,
          unitValue:
            item.unitCost,
          value:
            item.currentStock *
            item.unitCost,
        }
      }

      if (
        item.sellingPriceKnown ===
          true &&
        (item.sellingPrice ?? 0) >
          0
      ) {
        return {
          item,
          basis: 'retail' as const,
          unitValue:
            item.sellingPrice ?? 0,
          value:
            item.currentStock *
            (item.sellingPrice ?? 0),
        }
      }

      return null
    })
    .filter(
      (
        row,
      ): row is NonNullable<
        typeof row
      > => row !== null,
    )

  const total = valued.reduce(
    (sum, row) =>
      sum + row.value,
    0,
  )

  if (total <= 0) {
    return []
  }

  return valued
    .sort(
      (a, b) =>
        b.value - a.value,
    )
    .slice(0, 5)
    .map((row) => {
      const share =
        (row.value / total) * 100

      const evidence = [
        `${row.item.currentStock} units currently in stock`,
        row.basis === 'cost'
          ? `Cost-basis inventory value: ${formatMoney(
              row.value,
              currency,
            )}`
          : `Retail inventory value: ${formatMoney(
              row.value,
              currency,
            )} (selling-price basis, not capital cost)`,
        `${share.toFixed(
          1,
        )}% of measurable inventory value`,
      ]

      if (
        row.item.leadTimeKnown !==
          false &&
        row.item.leadTimeDays >
          0
      ) {
        evidence.push(
          `${row.item.leadTimeDays} day supplier lead time`,
        )
      }

      return {
        category:
          'inventory_exposure' as const,

        sku: row.item.sku,

        productName:
          row.item.productName,

        title:
          row.basis === 'cost'
            ? `${row.item.productName} is a high-value inventory holding`
            : `${row.item.productName} has high retail inventory exposure`,

        evidence,

        impact: {
          value:
            Math.round(
              row.value,
            ),
          currency,
          type:
            'inventory_value_exposure' as const,
        },

        confidence:
          row.basis === 'cost'
            ? ('medium' as const)
            : ('low' as const),

        metadata: {
          currentStock:
            row.item.currentStock,

          inventorySharePct:
            Number(
              share.toFixed(1),
            ),

          valuationBasis:
            row.basis,
        },
      }
    })
}
