import type {
  InventoryInsight,
  InventoryRow,
} from '../types.js'
import { formatMoney } from './utils.js'

function median(values: number[]): number {
  if (!values.length) return 0

  const sorted = [...values].sort(
    (a, b) => a - b,
  )

  const middle = Math.floor(
    sorted.length / 2,
  )

  if (sorted.length % 2 === 0) {
    return (
      (sorted[middle - 1] +
        sorted[middle]) /
      2
    )
  }

  return sorted[middle]
}

function severityRank(
  severity: InventoryInsight['severity'],
): number {
  return {
    high: 3,
    medium: 2,
    info: 1,
  }[severity]
}

export function buildInventoryHealthInsights(
  inventory: InventoryRow[],
  currency: string,
): InventoryInsight[] {
  const insights: InventoryInsight[] = []

  if (!inventory.length) {
    return insights
  }

  const total = inventory.length

  const stockKnown = inventory.filter(
    (row) =>
      row.stockKnown !== false,
  ).length

  const costsKnown = inventory.filter(
    (row) =>
      row.unitCostKnown !== false,
  ).length

  const leadTimesKnown =
    inventory.filter(
      (row) =>
        row.leadTimeKnown !== false,
    ).length

  const sellingPrices =
    inventory
      .filter(
        (row) =>
          row.sellingPriceKnown ===
            true &&
          (row.sellingPrice ?? 0) >
            0,
      )
      .map(
        (row) =>
          row.sellingPrice ?? 0,
      )

  const readinessPercent = Math.round(
    ((stockKnown + costsKnown + leadTimesKnown + sellingPrices.length) /
      (total * 4)) *
      100,
  )

  insights.push({
    category: 'data_readiness',
    severity:
      readinessPercent < 40
        ? 'high'
        : readinessPercent < 75
          ? 'medium'
          : 'info',
    title: `${readinessPercent}% ready for deeper profit-leak analysis`,
    evidence: [
      'Readiness reflects coverage of stock quantity, unit cost, supplier lead time and selling price.',
      'Sales history is still required to verify movement-based findings such as dead inventory and stockout risk.',
    ],
    action:
      readinessPercent < 100
        ? 'Fill the highest-priority catalogue gaps below, then add sales history for a full investigation.'
        : 'Add sales history to unlock movement-based profit-leak investigation.',
    metric: {
      value: `${readinessPercent}%`,
      label: 'data readiness',
    },
  })

  if (stockKnown < total) {
    insights.push({
      category: 'tracking',
      severity:
        stockKnown === 0
          ? 'high'
          : 'medium',

      title:
        stockKnown === 0
          ? 'Stock quantities are not being tracked'
          : 'Some products have no usable stock quantity',

      evidence: [
        `${stockKnown} of ${total} products have usable stock quantities.`,
        'Without stock-on-hand data, LeakScout cannot verify stockout or dead-stock risk.',
      ],

      action:
        'Enable tracked inventory quantities or provide a stock-on-hand export.',

      metric: {
        value:
          `${stockKnown}/${total}`,
        label: 'stock quantities available',
      },
    })
  }

  if (costsKnown < total) {
    insights.push({
      category: 'cost_visibility',
      severity:
        costsKnown === 0
          ? 'high'
          : 'medium',

      title:
        costsKnown === 0
          ? 'Product cost visibility is missing'
          : 'Some products are missing unit cost',

      evidence: [
        `${costsKnown} of ${total} products include unit cost.`,
        'Unit cost is required to measure gross margin and capital tied up in inventory.',
      ],

      action:
        'Add purchase cost or unit cost to the product catalogue or inventory export.',

      metric: {
        value:
          `${costsKnown}/${total}`,
        label: 'unit costs available',
      },
    })
  }

  if (leadTimesKnown < total) {
    insights.push({
      category: 'tracking',
      severity: 'medium',

      title:
        'Supplier lead-time visibility is incomplete',

      evidence: [
        `${leadTimesKnown} of ${total} products include supplier lead time.`,
        'Lead time is needed to estimate whether inventory will run out before replenishment.',
      ],

      action:
        'Add supplier lead times for frequently reordered products.',

      metric: {
        value:
          `${leadTimesKnown}/${total}`,
        label: 'lead times available',
      },
    })
  }

  if (sellingPrices.length > 0) {
    const minPrice = Math.min(
      ...sellingPrices,
    )

    const maxPrice = Math.max(
      ...sellingPrices,
    )

    const medianPrice =
      median(sellingPrices)

    insights.push({
      category: 'pricing',
      severity: 'info',

      title:
        'Pricing structure is measurable',

      evidence: [
        `${sellingPrices.length} of ${total} products contain selling prices.`,
        `Price range: ${formatMoney(
          minPrice,
          currency,
        )} – ${formatMoney(
          maxPrice,
          currency,
        )}.`,
        `Median product price: ${formatMoney(
          medianPrice,
          currency,
        )}.`,
      ],

      action:
        'Use sales history alongside this pricing data to identify underpriced, overpriced or margin-compressed products.',

      metric: {
        value: formatMoney(
          medianPrice,
          currency,
        ),
        label: 'median selling price',
      },
    })
  }

  const availabilityKnown =
    inventory.filter(
      (row) =>
        row.available !== undefined,
    )

  if (availabilityKnown.length) {
    const unavailable =
      availabilityKnown.filter(
        (row) =>
          row.available === false,
      )

    insights.push({
      category: 'availability',
      severity:
        unavailable.length > 0
          ? 'medium'
          : 'info',

      title:
        unavailable.length > 0
          ? `${unavailable.length} product${unavailable.length === 1 ? '' : 's'} marked unavailable`
          : 'All tracked products are marked available',

      evidence: [
        `${availabilityKnown.length} of ${total} products include availability status.`,
        `${unavailable.length} are currently marked unavailable.`,
      ],

      action:
        unavailable.length > 0
          ? 'Review unavailable products and confirm whether they should be restocked, hidden or discontinued.'
          : 'Continue monitoring availability alongside sales and stock movement.',

      metric: {
        value:
          `${unavailable.length}`,
        label: 'products unavailable',
      },
    })
  }

  const categories =
    inventory
      .map(
        (row) =>
          row.category?.trim(),
      )
      .filter(
        (value): value is string =>
          Boolean(value),
      )

  if (categories.length) {
    const counts =
      new Map<string, number>()

    for (const category of categories) {
      counts.set(
        category,
        (counts.get(category) ?? 0) +
          1,
      )
    }

    const ranked = [
      ...counts.entries(),
    ].sort(
      (a, b) => b[1] - a[1],
    )

    const largest = ranked[0]

    const share =
      largest
        ? (largest[1] / total) *
          100
        : 0

    insights.push({
      category: 'assortment',
      severity:
        share >= 70
          ? 'medium'
          : 'info',

      title:
        'Assortment concentration identified',

      evidence: [
        `${counts.size} product categor${counts.size === 1 ? 'y' : 'ies'} represented.`,
        largest
          ? `${largest[0]} represents ${share.toFixed(
              1,
            )}% of the current catalogue.`
          : 'No dominant category was found.',
      ],

      action:
        'Compare category concentration with actual sales contribution once transaction data is available.',

      metric: {
        value:
          `${counts.size}`,
        label: 'categories represented',
      },
    })
  }

  const skuCounts =
    new Map<string, number>()

  const barcodeCounts =
    new Map<string, number>()

  let generatedSkuCount = 0
  let missingSkuCount = 0
  let missingBarcodeCount = 0

  for (const row of inventory) {
    if (
      row.skuGenerated === true
    ) {
      generatedSkuCount += 1
    }

    if (row.skuProvided === false) {
      missingSkuCount += 1
    }

    if (row.skuProvided !== false) {
      const normalizedSku = row.sku.toUpperCase()
      skuCounts.set(
        normalizedSku,
        (skuCounts.get(normalizedSku) ?? 0) + 1,
      )
    }

    if (row.barcode) {
      const normalizedBarcode = row.barcode.toUpperCase()
      barcodeCounts.set(
        normalizedBarcode,
        (barcodeCounts.get(
          normalizedBarcode,
        ) ?? 0) + 1,
      )
    } else {
      missingBarcodeCount += 1
    }
  }

  const duplicateSkus = [
    ...skuCounts.values(),
  ].filter(
    (count) => count > 1,
  ).length

  const duplicateBarcodes = [
    ...barcodeCounts.values(),
  ].filter(
    (count) => count > 1,
  ).length

  if (
    generatedSkuCount > 0 ||
    missingSkuCount > 0 ||
    missingBarcodeCount > 0 ||
    duplicateSkus > 0 ||
    duplicateBarcodes > 0
  ) {
    insights.push({
      category:
        'identifier_hygiene',

      severity:
        duplicateSkus > 0 ||
        duplicateBarcodes > 0
          ? 'high'
          : 'medium',

      title:
        'Product identifier hygiene needs attention',

      evidence: [
        `${generatedSkuCount} products required a generated fallback identifier.`,
        `${missingSkuCount} products have no explicit SKU.`,
        `${missingBarcodeCount} products have no barcode.`,
        `${duplicateSkus} duplicate SKU values detected.`,
        `${duplicateBarcodes} duplicate barcode values detected.`,
      ],

      action:
        'Assign unique SKUs and barcodes to products before connecting additional POS, ERP or inventory systems.',

      metric: {
        value:
          `${generatedSkuCount}`,
        label:
          'generated identifiers',
      },
    })
  }

  return insights.sort(
    (a, b) =>
      severityRank(b.severity) -
      severityRank(a.severity),
  )
}
