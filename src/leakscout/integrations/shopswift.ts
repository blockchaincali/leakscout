import { z } from 'zod'
import { validateCurrency } from '../analytics/utils.js'
import { InputError } from '../errors.js'
import type { InventoryRow, SalesRow } from '../types.js'

export const MAX_SHOPSWIFT_SALES_ROWS = 10_000
export const MAX_SHOPSWIFT_INVENTORY_ROWS = 5_000

const identifier = z.string().trim().min(1).max(200).optional()
const money = z.number().finite().nonnegative()

const saleSchema = z
  .object({
    date: z.string().trim().min(1).max(64),
    sku: identifier,
    barcode: identifier,
    productName: identifier,
    quantity: z.number().finite(),
    sellingPrice: money,
    unitCost: money.optional(),
  })
  .strict()
  .refine((row) => row.sku || row.barcode || row.productName, {
    message: 'Provide at least one of sku, barcode or productName.',
  })

const inventorySchema = z
  .object({
    sku: identifier,
    barcode: identifier,
    productName: identifier,
    currentStock: z
      .number()
      .finite()
      .refine((value) => value === -1 || value >= 0, {
        message: 'Stock must be non-negative or -1 for untracked stock.',
      })
      .optional(),
    unitCost: money.optional(),
    sellingPrice: money.optional(),
    supplierLeadTimeDays: z.number().finite().nonnegative().optional(),
    category: z.string().trim().min(1).max(200).optional(),
    available: z.boolean().optional(),
  })
  .strict()
  .refine((row) => row.sku || row.barcode || row.productName, {
    message: 'Provide at least one of sku, barcode or productName.',
  })

const payloadSchema = z
  .object({
    currency: z.string().trim().min(1).max(16),
    sales: z.array(saleSchema).max(MAX_SHOPSWIFT_SALES_ROWS).optional(),
    inventory: z.array(inventorySchema).max(MAX_SHOPSWIFT_INVENTORY_ROWS).optional(),
  })
  .strict()
  .refine(
    (payload) =>
      (payload.sales?.length ?? 0) > 0 ||
      (payload.inventory?.length ?? 0) > 0,
    { message: 'Add at least one sales or inventory row.' },
  )

export type ShopswiftAuditInput = {
  currency: string
  sales: SalesRow[]
  inventory: InventoryRow[]
}

function slug(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
}

function identity(row: {
  sku?: string
  barcode?: string
  productName?: string
}) {
  const sku = row.sku ?? row.barcode ?? `ITEM-${slug(row.productName ?? 'PRODUCT')}`

  return {
    sku,
    productName: row.productName ?? row.sku ?? row.barcode ?? sku,
  }
}

function parseDate(value: string, index: number): Date {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  const validShape =
    /^\d{4}-\d{2}-\d{2}$/.test(value) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)

  if (!dateParts || !validShape) {
    throw new InputError(
      `Invalid sales.${index}.date. Use YYYY-MM-DD or an ISO timestamp.`,
    )
  }

  const year = Number(dateParts[1])
  const month = Number(dateParts[2])
  const day = Number(dateParts[3])
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  const parsed = new Date(value)

  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    Number.isNaN(parsed.getTime())
  ) {
    throw new InputError(`Invalid sales.${index}.date.`)
  }

  return parsed
}

function validationMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  const path = issue?.path.length ? `${issue.path.join('.')}: ` : ''
  return `Invalid Shopswift payload. ${path}${issue?.message ?? 'Validation failed.'}`
}

export function parseShopswiftAuditPayload(input: unknown): ShopswiftAuditInput {
  const parsed = payloadSchema.safeParse(input)

  if (!parsed.success) {
    throw new InputError(validationMessage(parsed.error))
  }

  const currency = validateCurrency(parsed.data.currency)
  const sales: SalesRow[] = (parsed.data.sales ?? []).map((row, index) => {
    const product = identity(row)
    const costKnown = row.unitCost !== undefined

    return {
      date: parseDate(row.date, index),
      ...product,
      quantity: row.quantity,
      unitPrice: row.sellingPrice,
      unitCost: row.unitCost ?? 0,
      unitCostKnown: costKnown,
    }
  })

  const inventory: InventoryRow[] = (parsed.data.inventory ?? []).map((row) => {
    const product = identity(row)
    const stockKnown = row.currentStock !== undefined && row.currentStock !== -1
    const costKnown = row.unitCost !== undefined
    const leadTimeKnown = row.supplierLeadTimeDays !== undefined
    const sellingPriceKnown = row.sellingPrice !== undefined

    return {
      ...product,
      currentStock: stockKnown ? row.currentStock ?? 0 : 0,
      unitCost: row.unitCost ?? 0,
      leadTimeDays: row.supplierLeadTimeDays ?? 0,
      sellingPrice: row.sellingPrice,
      barcode: row.barcode,
      category: row.category,
      available: row.available,
      stockKnown,
      unitCostKnown: costKnown,
      leadTimeKnown,
      sellingPriceKnown,
      skuGenerated: !row.sku && !row.barcode,
      skuProvided: Boolean(row.sku),
    }
  })

  return { currency, sales, inventory }
}
