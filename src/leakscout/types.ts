export type SalesRow = {
  date: Date
  sku: string
  productName: string
  quantity: number
  unitPrice: number
  unitCost: number
}

export type InventoryRow = {
  sku: string
  productName: string
  currentStock: number
  unitCost: number
  leadTimeDays: number
}

export type ImpactType =
  | 'revenue_at_risk'
  | 'monthly_profit_leak'
  | 'capital_tied_up'
  | 'revenue_decline'

export type LeakCategory =
  | 'stockout_risk'
  | 'margin_compression'
  | 'dead_inventory'
  | 'sales_anomaly'

export type LeakCandidate = {
  category: LeakCategory
  sku?: string
  productName?: string
  title: string
  evidence: string[]
  impact: {
    value: number
    currency: 'NGN'
    type: ImpactType
  }
  confidence: 'high' | 'medium' | 'low'
  metadata?: Record<string, number | string>
}

export type AuditResult = {
  summary: {
    transactions: number
    products: number
    periodDays: number
    revenue: number
  }
  candidates: LeakCandidate[]
}
