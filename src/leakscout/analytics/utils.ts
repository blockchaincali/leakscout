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

export function currency(value: number): string {
  return `₦${Math.round(value).toLocaleString('en-NG')}`
}
