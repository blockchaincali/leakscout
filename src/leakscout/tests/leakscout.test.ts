import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { once } from 'node:events'
import {
  parseInventoryCsvText,
  parseSalesCsvText,
} from '../analytics/parser.js'
import { runProfitAudit } from '../analytics/audit.js'
import {
  inventoryQuality,
  runInventoryOnlyAudit,
  runSalesOnlyAudit,
} from '../analytics/partialAudit.js'
import { findDeadInventory } from '../analytics/deadStock.js'
import { findStockoutRisks } from '../analytics/stockout.js'
import { findMarginLeaks } from '../analytics/margins.js'
import { findSalesAnomalies } from '../analytics/anomalies.js'
import { executeLeakScout } from '../web/service.js'
import { createLeakScoutApp } from '../web/server.js'
import type { InventoryRow, SalesRow } from '../types.js'
import {
  parseInvestigationCategories,
  validatePrioritySelections,
} from '../agent/validation.js'
import type { CandidateWithId } from '../agent/leakScout.js'

const sale = (
  date: string,
  overrides: Partial<SalesRow> = {},
): SalesRow => ({
  date: new Date(`${date}T00:00:00Z`),
  sku: 'SKU-1',
  productName: 'Widget',
  quantity: 1,
  unitPrice: 100,
  unitCost: 50,
  unitCostKnown: true,
  ...overrides,
})

const item = (overrides: Partial<InventoryRow> = {}): InventoryRow => ({
  sku: 'SKU-1',
  productName: 'Widget',
  currentStock: 10,
  unitCost: 50,
  leadTimeDays: 7,
  stockKnown: true,
  unitCostKnown: true,
  leadTimeKnown: true,
  ...overrides,
})

test('parses standard sales CSV and ISO timestamps', () => {
  const rows = parseSalesCsvText(
    'date,sku,product_name,quantity,unit_price,unit_cost\n' +
      '2026-01-02T10:30:00Z,SKU-1,Widget,2,"1,250",700',
  )

  assert.equal(rows.length, 1)
  assert.equal(rows[0].date.toISOString(), '2026-01-02T10:30:00.000Z')
  assert.equal(rows[0].unitPrice, 1250)
  assert.equal(rows[0].unitCost, 700)
})

test('maps aliases regardless of order and ignores extra columns', () => {
  const rows = parseSalesCsvText(
    'notes,Selling Price,sold_at,Product Name,purchase cost,Quantity,barcode\n' +
      'ignored,4250,2026-02-03,Tea,2500,3,BC-10',
  )

  assert.equal(rows[0].sku, 'BC-10')
  assert.equal(rows[0].productName, 'Tea')
  assert.equal(rows[0].quantity, 3)
  assert.equal(rows[0].unitPrice, 4250)
  assert.equal(rows[0].unitCost, 2500)
})

test('parses Shopswift inventory and keeps stock -1 unknown', () => {
  const [row] = parseInventoryCsvText(
    'name,price,stock,category,barcode,sku,description,available\n' +
      'Coffee,4250,-1,Drinks,12345,COF-1,Ground coffee,true',
  )

  assert.equal(row.currentStock, 0)
  assert.equal(row.stockKnown, false)
  assert.equal(row.sellingPrice, 4250)
  assert.equal(row.unitCostKnown, false)
  assert.equal(row.available, true)
  assert.equal(row.category, 'Drinks')
})

test('does not interpret selling price as unit cost', () => {
  const [row] = parseInventoryCsvText(
    'sku,product name,quantity on hand,selling price\nA-1,Apron,4,12000',
  )

  assert.equal(row.unitCost, 0)
  assert.equal(row.unitCostKnown, false)
  assert.equal(row.sellingPrice, 12000)
  assert.equal(row.sellingPriceKnown, true)
  assert.equal(row.leadTimeKnown, false)
})

test('only the Shopswift -1 sentinel is unknown stock', () => {
  const [row] = parseInventoryCsvText(
    'sku,product name,current stock\nA-1,Apron,-2',
  )

  assert.equal(row.currentStock, -2)
  assert.equal(row.stockKnown, true)
})

test('generates a fallback SKU while recording the identifier gap', () => {
  const [row] = parseInventoryCsvText(
    'product name,current stock\nCanvas Bag,8',
  )

  assert.equal(row.sku, 'ITEM-CANVAS-BAG')
  assert.equal(row.skuGenerated, true)
})

test('rejects malformed CSV, invalid dates and supplied invalid numbers', () => {
  assert.throws(
    () => parseSalesCsvText('date,sku,product_name,quantity,unit_price\n"broken'),
    /Could not parse sales CSV/,
  )
  assert.throws(
    () => parseSalesCsvText('date,sku,product_name,quantity,unit_price\n2026-02-30,A,A,1,4'),
    /Invalid date/,
  )
  assert.throws(
    () => parseInventoryCsvText('sku,product name,stock,unit cost\nA,A,2,unknown'),
    /Invalid unit cost/,
  )
  assert.throws(
    () => parseInventoryCsvText('sku,product name,stock,unit cost\nA,A,2,-4'),
    /must be at least 0/,
  )
})

test('rejects empty files and files beyond the row limit', () => {
  assert.throws(() => parseInventoryCsvText('sku,stock\n'), /no data rows/)

  const rows = Array.from({ length: 5001 }, (_, index) => `SKU-${index},Item ${index},1`)
  assert.throws(
    () => parseInventoryCsvText(`sku,product name,stock\n${rows.join('\n')}`),
    /5,000-row MVP limit/,
  )
})

test('reports duplicate identifiers, coverage and pricing median/range', () => {
  const inventory = parseInventoryCsvText(
    'sku,barcode,product name,stock,selling price,category,available\n' +
      'A,111,Alpha,3,100,Core,true\n' +
      'A,111,Beta,4,300,Core,false\n' +
      ',,Gamma,-1,200,Other,true',
  )
  const quality = inventoryQuality(inventory)
  const audit = runInventoryOnlyAudit(inventory, 'NGN')
  const pricing = audit.inventoryInsights?.find((insight) => insight.category === 'pricing')

  assert.equal(quality.duplicateSkus, 1)
  assert.equal(quality.duplicateBarcodes, 1)
  assert.equal(quality.stockKnown, 2)
  assert.equal(quality.barcodeKnown, 2)
  assert.equal(pricing?.metric?.value, '₦200')
  assert.match(pricing?.evidence.join(' ') ?? '', /₦100.*₦300/)
})

test('inventory-only audits never fabricate capital cost from retail prices', () => {
  const inventory = parseInventoryCsvText(
    'sku,product name,stock,selling price\nA,Alpha,5,1000\nB,Beta,-1,2000',
  )
  const audit = runInventoryOnlyAudit(inventory, 'NGN')

  assert.equal(audit.summary.inventoryValue, undefined)
  assert.equal(audit.summary.retailInventoryValue, 5000)
  assert.equal(audit.candidates.length, 1)
  assert.equal(audit.candidates[0].metadata?.valuationBasis, 'retail')
  assert.notEqual(audit.candidates[0].impact.type, 'capital_tied_up')
})

test('unknown stock cannot become zero stock or financial exposure', () => {
  const inventory = parseInventoryCsvText(
    'sku,product name,stock,unit cost,selling price\nA,Alpha,-1,500,1000',
  )
  const audit = runInventoryOnlyAudit(inventory, 'NGN')

  assert.equal(audit.summary.inventoryValue, undefined)
  assert.equal(audit.summary.retailInventoryValue, undefined)
  assert.deepEqual(audit.candidates, [])
})

test('known zero stock remains a measured zero rather than unknown', () => {
  const inventory = parseInventoryCsvText(
    'sku,product name,stock,unit cost\nA,Alpha,0,500',
  )
  const audit = runInventoryOnlyAudit(inventory, 'NGN')

  assert.equal(audit.summary.inventoryValue, 0)
  assert.equal(audit.summary.inventoryDataQuality?.stockKnown, 1)
})

test('sales-only audits work without costs and create no margin leakage', () => {
  const sales = parseSalesCsvText(
    'date,sku,product name,quantity,selling price\n' +
      '2026-01-01,A,Alpha,2,4250\n2026-02-10,A,Alpha,1,4250',
  )
  const audit = runSalesOnlyAudit(sales, 'NGN')

  assert.equal(audit.summary.revenue, 12750)
  assert.equal(audit.summary.salesDataQuality?.unitCostKnown, 0)
  assert.equal(audit.candidates.some((candidate) => candidate.category === 'margin_compression'), false)
})

test('margin calculations use known cost data only', () => {
  const candidates = findMarginLeaks([
    sale('2026-01-20', { quantity: 10, unitCost: 50 }),
    sale('2026-03-01', { quantity: 10, unitCost: 70 }),
  ], 'USD')

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].impact.value, 200)
  assert.equal(candidates[0].impact.type, 'monthly_profit_leak')
})

test('dead stock requires stock, cost and at least 45 days of observation', () => {
  const inventory = [item({ sku: 'OLD', productName: 'Old stock' })]
  const shortWindow = [sale('2026-02-20'), sale('2026-03-01')]
  const longWindow = [sale('2026-01-01'), sale('2026-03-01')]

  assert.equal(findDeadInventory(shortWindow, inventory, 'USD').length, 0)
  assert.equal(findDeadInventory(longWindow, inventory, 'USD').length, 1)
  assert.equal(
    findDeadInventory(longWindow, [item({ sku: 'OLD', stockKnown: false })], 'USD').length,
    0,
  )
  assert.equal(
    findDeadInventory(longWindow, [item({ sku: 'OLD', unitCostKnown: false })], 'USD').length,
    0,
  )
})

test('stockout safeguards require known stock and lead time', () => {
  const sales = [sale('2026-03-01', { quantity: 30 })]

  assert.equal(findStockoutRisks(sales, [item({ currentStock: 1, leadTimeDays: 10 })], 'USD').length, 1)
  assert.equal(findStockoutRisks(sales, [item({ stockKnown: false })], 'USD').length, 0)
  assert.equal(findStockoutRisks(sales, [item({ leadTimeKnown: false })], 'USD').length, 0)
})

test('sales anomaly calculations compare recent revenue with prior run rate', () => {
  const candidates = findSalesAnomalies([
    sale('2026-02-10', { quantity: 400, unitPrice: 10 }),
    sale('2026-03-01', { quantity: 10, unitPrice: 10 }),
  ], 'USD')

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].impact.value, 900)
  assert.equal(candidates[0].impact.type, 'revenue_decline')
})

test('full deterministic audit includes verified detector output', () => {
  const sales = [
    sale('2026-01-01', { sku: 'OTHER' }),
    sale('2026-02-10', { quantity: 400, unitPrice: 10 }),
    sale('2026-03-01', { quantity: 10, unitPrice: 10 }),
  ]
  const inventory = [item({ currentStock: 1, leadTimeDays: 10 })]
  const audit = runProfitAudit(sales, inventory, 'USD')

  assert.equal(audit.summary.currency, 'USD')
  assert.ok(audit.candidates.some((candidate) => candidate.category === 'stockout_risk'))
  assert.ok(audit.candidates.some((candidate) => candidate.category === 'sales_anomaly'))
})

test('source currency labels values without performing conversion', async () => {
  const sales = [sale('2026-01-01', { unitPrice: 4250, unitCostKnown: false })]
  const ngn = await executeLeakScout(sales, [], 'NGN')
  const usd = await executeLeakScout(sales, [], 'USD')

  assert.equal(ngn.audit.summary.revenue, 4250)
  assert.equal(usd.audit.summary.revenue, 4250)
  assert.equal(ngn.audit.summary.currency, 'NGN')
  assert.equal(usd.audit.summary.currency, 'USD')
  assert.equal(usd.currencySemantics, 'source_accounting_currency')
  assert.throws(() => runSalesOnlyAudit(sales, 'not-money'), /Invalid currency/)
})

test('agent input handling falls back safely and rejects invalid selections', () => {
  assert.ok(parseInvestigationCategories('{bad json').includes('stockout_risk'))

  const candidates: CandidateWithId[] = ['C1', 'C2', 'C3'].map((id, index) => ({
    id,
    category: 'sales_anomaly',
    sku: `SKU-${index}`,
    productName: `Product ${index}`,
    title: `Signal ${index}`,
    evidence: ['Verified evidence'],
    impact: { value: 100 + index, currency: 'USD', type: 'revenue_decline' },
    confidence: 'high',
  }))
  const inspected = new Set(['C1', 'C2', 'C3'])

  assert.throws(
    () => validatePrioritySelections(candidates, [
      { candidateId: 'C1', urgency: 'today' },
      { candidateId: 'C1', urgency: 'monitor' },
      { candidateId: 'C3', urgency: 'this_week' },
    ], inspected),
    /Duplicate candidate/,
  )
  assert.throws(
    () => validatePrioritySelections(candidates, [
      { candidateId: 'C1', urgency: 'today' },
      { candidateId: 'C2', urgency: 'monitor' },
      { candidateId: 'UNKNOWN', urgency: 'this_week' },
    ], inspected),
    /unknown candidate/,
  )
  assert.throws(
    () => validatePrioritySelections(candidates, [
      { candidateId: 'C1', urgency: 'today' },
      { candidateId: 'C2', urgency: 'monitor' },
      { candidateId: 'C3', urgency: 'this_week' },
    ], new Set(['C1', 'C2'])),
    /did not inspect/,
  )
})

let server: Server
let baseUrl: string

before(async () => {
  server = createLeakScoutApp().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  server.close()
  await once(server, 'close')
})

test('health endpoint exposes a clean integration contract', async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  const body = await response.json() as Record<string, unknown>

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.service, 'LeakScout')
  assert.equal(body.currencySemantics, 'source_accounting_currency')
})

test('audit API validates missing files and malformed input', async () => {
  const emptyResponse = await fetch(`${baseUrl}/api/audit`, {
    method: 'POST',
    body: new FormData(),
  })
  assert.equal(emptyResponse.status, 400)

  const malformed = new FormData()
  malformed.append('inventory', new Blob(['sku,stock\n"broken']), 'inventory.csv')
  const malformedResponse = await fetch(`${baseUrl}/api/audit`, {
    method: 'POST',
    body: malformed,
  })
  assert.equal(malformedResponse.status, 400)
})

test('audit API supports partial inventory and sourceCurrency', async () => {
  const form = new FormData()
  form.append(
    'inventory',
    new Blob(['name,price,stock,category,barcode,sku,available\nCoffee,4250,-1,Drinks,123,COF,true']),
    'shopswift.csv',
  )
  form.append('sourceCurrency', 'NGN')

  const response = await fetch(`${baseUrl}/api/audit`, { method: 'POST', body: form })
  const body = await response.json() as {
    dataMode: string
    agentUsed: boolean
    audit: { summary: { currency: string; inventoryDataQuality: { stockKnown: number } } }
  }

  assert.equal(response.status, 200)
  assert.equal(body.dataMode, 'inventory_only')
  assert.equal(body.agentUsed, false)
  assert.equal(body.audit.summary.currency, 'NGN')
  assert.equal(body.audit.summary.inventoryDataQuality.stockKnown, 0)
})

test('audit API rejects invalid source currency', async () => {
  const form = new FormData()
  form.append('inventory', new Blob(['sku,product name,stock\nA,Alpha,1']), 'inventory.csv')
  form.append('sourceCurrency', 'INVALID')

  const response = await fetch(`${baseUrl}/api/audit`, { method: 'POST', body: form })
  assert.equal(response.status, 400)
})
