import type { InventoryRow, SalesRow } from '../types.js'

/**
 * Fixed illustrative demo rates, expressed as NGN per one unit of the target
 * currency. They are intentionally stable so the public synthetic demo is
 * repeatable; they are not live market exchange rates.
 */
export const DEMO_NGN_PER_UNIT = {
  USD: 1_600,
  NGN: 1,
  GBP: 2_100,
  EUR: 1_750,
  GHS: 120,
  KES: 12.4,
  ZAR: 87,
  CAD: 1_160,
  AUD: 1_050,
  INR: 19,
  JPY: 10.5,
  AED: 435,
  SAR: 426,
  CHF: 1_850,
  SGD: 1_190,
  NZD: 960,
} as const

export type DemoCurrency = keyof typeof DEMO_NGN_PER_UNIT

export function demoCurrencyMultiplier(currency: DemoCurrency): number {
  return 1 / DEMO_NGN_PER_UNIT[currency]
}

function convertMoney(value: number, multiplier: number): number {
  return value * multiplier
}

/**
 * Converts the canonical NGN synthetic fixtures without mutating their rows.
 * Only known monetary fields are converted; operational values stay verbatim.
 */
export function convertDemoDataset(
  sales: SalesRow[],
  inventory: InventoryRow[],
  currency: DemoCurrency,
): { sales: SalesRow[]; inventory: InventoryRow[] } {
  const multiplier = demoCurrencyMultiplier(currency)

  return {
    sales: sales.map((row) => ({
      ...row,
      date: new Date(row.date.getTime()),
      unitPrice: convertMoney(row.unitPrice, multiplier),
      unitCost: row.unitCostKnown === false
        ? row.unitCost
        : convertMoney(row.unitCost, multiplier),
    })),
    inventory: inventory.map((row) => ({
      ...row,
      unitCost: row.unitCostKnown === false
        ? row.unitCost
        : convertMoney(row.unitCost, multiplier),
      sellingPrice: row.sellingPriceKnown === true && row.sellingPrice !== undefined
        ? convertMoney(row.sellingPrice, multiplier)
        : row.sellingPrice,
    })),
  }
}
