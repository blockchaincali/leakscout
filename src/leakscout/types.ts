export type SalesRow = {
  date: Date
  sku: string
  productName: string
  quantity: number
  unitPrice: number
  unitCost: number
  unitCostKnown?: boolean
}

export type InventoryRow = {
  sku: string
  productName: string
  currentStock: number
  unitCost: number
  leadTimeDays: number

  sellingPrice?: number
  barcode?: string
  category?: string
  available?: boolean

  stockKnown?: boolean
  unitCostKnown?: boolean
  leadTimeKnown?: boolean
  sellingPriceKnown?: boolean
  skuGenerated?: boolean
  skuProvided?: boolean
}

export type ImpactType =
  | 'revenue_at_risk'
  | 'monthly_profit_leak'
  | 'capital_tied_up'
  | 'revenue_decline'
  | 'inventory_value_exposure'

export type LeakCategory =
  | 'stockout_risk'
  | 'margin_compression'
  | 'dead_inventory'
  | 'sales_anomaly'
  | 'inventory_exposure'

export type LeakCandidate = {
  category: LeakCategory
  sku?: string
  productName?: string
  title: string
  evidence: string[]
  impact: {
    value: number
    currency: string
    type: ImpactType
  }
  confidence: 'high' | 'medium' | 'low'
  metadata?: Record<string, number | string>
}

export type InventoryDataQuality = {
  totalRows: number
  stockKnown: number
  unitCostKnown: number
  leadTimeKnown: number
  sellingPriceKnown: number
  availabilityKnown: number
  categoryKnown: number
  skuKnown: number
  barcodeKnown: number
  duplicateSkus: number
  duplicateBarcodes: number
  readinessPercent: number
  stockAndCostKnown: number
  stockAndLeadTimeKnown: number
}

export type SalesDataQuality = {
  totalRows: number
  unitCostKnown: number
}

export type InventoryInsight = {
  category:
    | 'tracking'
    | 'cost_visibility'
    | 'pricing'
    | 'availability'
    | 'assortment'
    | 'identifier_hygiene'
    | 'data_readiness'

  severity: 'high' | 'medium' | 'info'

  title: string
  evidence: string[]
  action: string

  metric?: {
    value: string
    label: string
  }
}

export type AuditResult = {
  summary: {
    transactions: number
    products: number
    periodDays: number
    revenue: number
    inventoryValue?: number
    retailInventoryValue?: number
    currency: string
    inventoryDataQuality?: InventoryDataQuality
    salesDataQuality?: SalesDataQuality
  }

  candidates: LeakCandidate[]

  inventoryInsights?: InventoryInsight[]
}
