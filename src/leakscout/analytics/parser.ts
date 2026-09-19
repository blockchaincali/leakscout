import { readFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'
import type { InventoryRow, SalesRow } from '../types.js'

function requireText(value: unknown, field: string): string {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`Missing required field: ${field}`)
  return text
}

function requireNumber(value: unknown, field: string): number {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid number for ${field}: ${String(value)}`)
  }
  return num
}

export async function loadSalesCsv(path: string): Promise<SalesRow[]> {
  const raw = await readFile(path, 'utf8')

  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[]

  if (records.length > 10_000) {
    throw new Error('Sales CSV exceeds the 10,000-row MVP limit.')
  }

  return records.map((row, index) => {
    const dateText = requireText(row.date, `date at row ${index + 2}`)
    const date = new Date(`${dateText}T00:00:00Z`)

    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid date at row ${index + 2}: ${dateText}`)
    }

    return {
      date,
      sku: requireText(row.sku, `sku at row ${index + 2}`),
      productName: requireText(
        row.product_name,
        `product_name at row ${index + 2}`,
      ),
      quantity: requireNumber(row.quantity, `quantity at row ${index + 2}`),
      unitPrice: requireNumber(
        row.unit_price,
        `unit_price at row ${index + 2}`,
      ),
      unitCost: requireNumber(
        row.unit_cost,
        `unit_cost at row ${index + 2}`,
      ),
    }
  })
}

export async function loadInventoryCsv(
  path: string,
): Promise<InventoryRow[]> {
  const raw = await readFile(path, 'utf8')

  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[]

  return records.map((row, index) => ({
    sku: requireText(row.sku, `sku at row ${index + 2}`),
    productName: requireText(
      row.product_name,
      `product_name at row ${index + 2}`,
    ),
    currentStock: requireNumber(
      row.current_stock,
      `current_stock at row ${index + 2}`,
    ),
    unitCost: requireNumber(
      row.unit_cost,
      `unit_cost at row ${index + 2}`,
    ),
    leadTimeDays: requireNumber(
      row.lead_time_days,
      `lead_time_days at row ${index + 2}`,
    ),
  }))
}
