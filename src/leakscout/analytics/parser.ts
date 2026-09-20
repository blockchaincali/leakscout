import { readFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'
import type {
  InventoryRow,
  SalesRow,
} from '../types.js'
import { InputError } from '../errors.js'

const MAX_SALES_ROWS = 10_000
const MAX_INVENTORY_ROWS = 5_000

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function findRaw(
  row: Record<string, string>,
  aliases: string[],
): string | undefined {
  const keys = Object.keys(row)

  for (const alias of aliases) {
    const wanted = normalizeHeader(alias)

    const key = keys.find(
      (candidate) =>
        normalizeHeader(candidate) === wanted,
    )

    if (key !== undefined) {
      const value = String(
        row[key] ?? '',
      ).trim()

      if (value !== '') {
        return value
      }
    }
  }

  return undefined
}

function recordsFromCsv(
  raw: string,
  label: string,
): Record<string, string>[] {
  try {
    return parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as Record<string, string>[]
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown CSV parsing error'

    throw new InputError(
      `Could not parse ${label}: ${message}`,
    )
  }
}

function parseNumericText(raw: string): number {
  const compact = raw.trim().replace(/,/g, '')
  const accounting = /^\((.+)\)$/.exec(compact)
  const normalized = accounting ? `-${accounting[1]}` : compact

  return Number(normalized)
}

function requiredNumber(
  raw: string | undefined,
  field: string,
  rowNumber: number,
  options: { minimum?: number } = {},
): number {
  if (raw === undefined) {
    throw new InputError(
      `Could not find ${field} at row ${rowNumber}.`,
    )
  }

  const value = parseNumericText(raw)

  if (!Number.isFinite(value)) {
    throw new InputError(
      `Invalid ${field} at row ${rowNumber}: ${raw}`,
    )
  }

  if (options.minimum !== undefined && value < options.minimum) {
    throw new InputError(
      `${field} at row ${rowNumber} must be at least ${options.minimum}.`,
    )
  }

  return value
}

function optionalNumber(
  raw: string | undefined,
  options: {
    unknownValues?: number[]
    field?: string
    rowNumber?: number
    minimum?: number
  } = {},
): {
  value: number
  known: boolean
} {
  if (
    raw === undefined ||
    raw.trim() === ''
  ) {
    return {
      value: 0,
      known: false,
    }
  }

  const value = parseNumericText(raw)

  if (!Number.isFinite(value)) {
    const location = options.rowNumber
      ? ` at row ${options.rowNumber}`
      : ''

    throw new InputError(
      `Invalid ${options.field ?? 'number'}${location}: ${raw}`,
    )
  }

  if (options.minimum !== undefined && value < options.minimum) {
    throw new InputError(
      `${options.field ?? 'number'} at row ${options.rowNumber ?? '?'} must be at least ${options.minimum}.`,
    )
  }

  if (
    options.unknownValues?.includes(value)
  ) {
    return {
      value: 0,
      known: false,
    }
  }

  return {
    value,
    known: true,
  }
}

function parseDate(
  raw: string,
  rowNumber: number,
): Date {
  const value = raw.trim()
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

  if (isoDate) {
    const year = Number(isoDate[1])
    const month = Number(isoDate[2])
    const day = Number(isoDate[3])
    const date = new Date(Date.UTC(year, month - 1, day))

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new InputError(`Invalid date at row ${rowNumber}: ${raw}`)
    }

    return date
  }

  // ISO timestamps are common in commerce exports and are unambiguous.
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value)

    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  throw new InputError(
    `Invalid date at row ${rowNumber}: ${raw}. Use YYYY-MM-DD or an ISO timestamp.`,
  )
}

function slug(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
}

function parseAvailability(
  raw: string | undefined,
): boolean | undefined {
  if (raw === undefined) return undefined

  const value = raw.trim().toLowerCase()

  if (
    ['yes', 'true', '1', 'active', 'available'].includes(
      value,
    )
  ) {
    return true
  }

  if (
    ['no', 'false', '0', 'inactive', 'unavailable'].includes(
      value,
    )
  ) {
    return false
  }

  return undefined
}

/* -------------------------------------------------------------------------- */
/* SALES COLUMN ALIASES                                                       */
/* -------------------------------------------------------------------------- */

const SALES = {
  date: [
    'date',
    'transaction_date',
    'transaction date',
    'sold_at',
    'sold at',
    'created_at',
    'created at',
    'sale_date',
    'sale date',
  ],

  sku: [
    'sku',
    'product_sku',
    'product sku',
    'item_sku',
    'item sku',
    'product_code',
    'product code',
    'code',
  ],

  barcode: [
    'barcode',
    'ean',
    'ean13',
    'upc',
    'gtin',
  ],

  productName: [
    'product_name',
    'product name',
    'name',
    'product',
    'item',
    'item_name',
    'item name',
    'title',
  ],

  quantity: [
    'quantity',
    'qty',
    'units',
    'units_sold',
    'units sold',
    'quantity_sold',
    'quantity sold',
  ],

  unitPrice: [
    'unit_price',
    'unit price',
    'price',
    'selling_price',
    'selling price',
    'sale_price',
    'sale price',
    'retail_price',
    'retail price',
  ],

  unitCost: [
    'unit_cost',
    'unit cost',
    'cost',
    'cost_price',
    'cost price',
    'purchase_price',
    'purchase price',
    'buying_price',
    'buying price',
    'purchase_cost',
    'purchase cost',
  ],
}

/* -------------------------------------------------------------------------- */
/* INVENTORY COLUMN ALIASES                                                   */
/* -------------------------------------------------------------------------- */

const INVENTORY = {
  sku: SALES.sku,

  barcode: SALES.barcode,

  productName: SALES.productName,

  currentStock: [
    'current_stock',
    'current stock',
    'stock',
    'stock_qty',
    'stock qty',
    'stock_quantity',
    'stock quantity',
    'quantity_on_hand',
    'quantity on hand',
    'on_hand',
    'on hand',
    'inventory',
    'inventory_qty',
    'inventory qty',
    'available_stock',
    'available stock',
  ],

  unitCost: SALES.unitCost,

  sellingPrice: SALES.unitPrice,

  leadTimeDays: [
    'lead_time_days',
    'lead time days',
    'lead_time',
    'lead time',
    'supplier_lead_time',
    'supplier lead time',
    'supplier_lead_days',
    'supplier lead days',
    'lead_days',
    'lead days',
  ],

  category: [
    'category',
    'product_category',
    'product category',
    'department',
    'group',
  ],

  available: [
    'available',
    'active',
    'enabled',
    'status',
    'is_available',
    'is available',
  ],
}

export function parseSalesCsvText(
  raw: string,
): SalesRow[] {
  const records =
    recordsFromCsv(
      raw,
      'sales CSV',
    )

  if (records.length === 0) {
    throw new InputError(
      'Sales CSV contains no data rows.',
    )
  }

  if (
    records.length >
    MAX_SALES_ROWS
  ) {
    throw new InputError(
      `Sales CSV exceeds the ${MAX_SALES_ROWS.toLocaleString()}-row MVP limit.`,
    )
  }

  return records.map(
    (row, index) => {
      const line = index + 2

      const dateText = findRaw(
        row,
        SALES.date,
      )

      if (!dateText) {
        throw new InputError(
          `Could not identify a sale-date column. Supported examples include date, transaction_date and sold_at.`,
        )
      }

      const date = parseDate(dateText, line)

      const name =
        findRaw(
          row,
          SALES.productName,
        ) ?? ''

      const barcode =
        findRaw(
          row,
          SALES.barcode,
        ) ?? ''

      const explicitSku =
        findRaw(
          row,
          SALES.sku,
        ) ?? ''

      const sku =
        explicitSku ||
        barcode ||
        `ITEM-${slug(name || 'PRODUCT')}`

      const productName =
        name ||
        explicitSku ||
        barcode

      if (!productName) {
        throw new InputError(
          `Could not identify a product-name or SKU column at row ${line}.`,
        )
      }

      const quantity =
        requiredNumber(
          findRaw(
            row,
            SALES.quantity,
          ),
          'quantity',
          line,
        )

      const unitPrice =
        requiredNumber(
          findRaw(
            row,
            SALES.unitPrice,
          ),
          'selling price',
          line,
          { minimum: 0 },
        )

      const cost =
        optionalNumber(
          findRaw(
            row,
            SALES.unitCost,
          ),
          {
            field: 'unit cost',
            rowNumber: line,
            minimum: 0,
          },
        )

      return {
        date,
        sku,
        productName,
        quantity,
        unitPrice,
        unitCost: cost.value,
        unitCostKnown:
          cost.known,
      }
    },
  )
}

export function parseInventoryCsvText(
  raw: string,
): InventoryRow[] {
  const records =
    recordsFromCsv(
      raw,
      'inventory CSV',
    )

  if (records.length === 0) {
    throw new InputError(
      'Inventory CSV contains no data rows.',
    )
  }

  if (
    records.length >
    MAX_INVENTORY_ROWS
  ) {
    throw new InputError(
      `Inventory CSV exceeds the ${MAX_INVENTORY_ROWS.toLocaleString()}-row MVP limit.`,
    )
  }

  return records.map(
    (row, index) => {
      const line = index + 2

      const productName =
        findRaw(
          row,
          INVENTORY.productName,
        ) ?? ''

      const barcode =
        findRaw(
          row,
          INVENTORY.barcode,
        ) ?? ''

      const explicitSku =
        findRaw(
          row,
          INVENTORY.sku,
        ) ?? ''

      if (
        !productName &&
        !explicitSku &&
        !barcode
      ) {
        throw new InputError(
          'Could not identify a product name, SKU or barcode column in the inventory file.',
        )
      }

      const sku =
        explicitSku ||
        barcode ||
        `ITEM-${slug(productName || 'PRODUCT')}`

      const stock =
        optionalNumber(
          findRaw(
            row,
            INVENTORY.currentStock,
          ),
          {
            /*
             * Several POS systems use negative stock such as -1
             * to mean untracked/unlimited.
             *
             * LeakScout treats it as UNKNOWN, never as literal
             * negative inventory and never as zero inventory.
             */
            unknownValues: [-1],
            field: 'stock quantity',
            rowNumber: line,
          },
        )

      const cost =
        optionalNumber(
          findRaw(
            row,
            INVENTORY.unitCost,
          ),
          {
            field: 'unit cost',
            rowNumber: line,
            minimum: 0,
          },
        )

      const leadTime =
        optionalNumber(
          findRaw(
            row,
            INVENTORY.leadTimeDays,
          ),
          {
            field: 'supplier lead time',
            rowNumber: line,
            minimum: 0,
          },
        )

      const sellingPrice =
        optionalNumber(
          findRaw(
            row,
            INVENTORY.sellingPrice,
          ),
          {
            field: 'selling price',
            rowNumber: line,
            minimum: 0,
          },
        )

      return {
        sku,
        productName:
          productName ||
          explicitSku ||
          barcode,

        currentStock:
          stock.value,

        unitCost:
          cost.value,

        leadTimeDays:
          leadTime.value,

        sellingPrice:
          sellingPrice.known
            ? sellingPrice.value
            : undefined,

        barcode:
          barcode || undefined,

        category:
          findRaw(
            row,
            INVENTORY.category,
          ),

        available:
          parseAvailability(
            findRaw(
              row,
              INVENTORY.available,
            ),
          ),

        stockKnown:
          stock.known,

        unitCostKnown:
          cost.known,

        leadTimeKnown:
          leadTime.known,

        sellingPriceKnown:
          sellingPrice.known,

        skuGenerated:
          !explicitSku && !barcode,

        skuProvided:
          Boolean(explicitSku),
      }
    },
  )
}

export async function loadSalesCsv(
  path: string,
): Promise<SalesRow[]> {
  return parseSalesCsvText(
    await readFile(
      path,
      'utf8',
    ),
  )
}

export async function loadInventoryCsv(
  path: string,
): Promise<InventoryRow[]> {
  return parseInventoryCsvText(
    await readFile(
      path,
      'utf8',
    ),
  )
}
