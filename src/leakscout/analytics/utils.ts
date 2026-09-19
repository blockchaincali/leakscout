import type { SalesRow } from '../types.js'

export const DAY_MS = 86_400_000

export function latestSalesDate(sales: SalesRow[]): Date {
  if (!sales.length) throw new Error('Sales file contains no transactions.')

  return new Date(Math.max(...sales.map((row) => row.date.getTime())))
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(a.getTime() - b.getTime()) / DAY_MS)
}

export function withinPreviousDays(
  date: Date,
  latest: Date,
  days: number,
): boolean {
  const diff = latest.getTime() - date.getTime()
  return diff >= 0 && diff < days * DAY_MS
}

const CURRENCY_LOCALES: Record<string, string> = {
  NGN: 'en-NG',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'en-IE',
  CAD: 'en-CA',
  AUD: 'en-AU',
  GHS: 'en-GH',
  KES: 'en-KE',
  ZAR: 'en-ZA',
  JPY: 'ja-JP',
  INR: 'en-IN',
}

export function validateCurrency(currency: string): string {
  const code = currency.trim().toUpperCase()

  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(
      `Invalid currency "${currency}". Use a 3-letter ISO currency code such as USD, GBP, EUR or NGN.`,
    )
  }

  try {
    new Intl.NumberFormat(CURRENCY_LOCALES[code] ?? 'en-US', {
      style: 'currency',
      currency: code,
    }).format(1)
  } catch {
    throw new Error(`Unsupported currency code: ${code}`)
  }

  return code
}

export function formatMoney(
  value: number,
  currency: string,
): string {
  const code = validateCurrency(currency)

  return new Intl.NumberFormat(
    CURRENCY_LOCALES[code] ?? 'en-US',
    {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    },
  ).format(Math.round(value))
}
