import { inspect } from 'node:util'
import { loadInventoryCsv, loadSalesCsv } from './analytics/parser.js'
import { runProfitAudit } from './analytics/audit.js'
import { formatMoney } from './analytics/utils.js'

const requestedCurrency = process.argv[2] ?? 'NGN'

const sales = await loadSalesCsv('demo/sales.csv')
const inventory = await loadInventoryCsv('demo/inventory.csv')

const audit = runProfitAudit(
  sales,
  inventory,
  requestedCurrency,
)

console.log('\n=== LEAKSCOUT LOCAL AUDIT ===\n')
console.log(`Currency: ${audit.summary.currency}`)
console.log(`Transactions: ${audit.summary.transactions}`)
console.log(`Products analyzed: ${audit.summary.products}`)
console.log(`Period: ${audit.summary.periodDays} days`)
console.log(
  `Revenue: ${formatMoney(
    audit.summary.revenue,
    audit.summary.currency,
  )}`,
)

console.log('\n=== CANDIDATES ===\n')

audit.candidates.forEach((candidate, index) => {
  console.log(`${index + 1}. ${candidate.title}`)
  console.log(
    `   Impact: ${formatMoney(
      candidate.impact.value,
      candidate.impact.currency,
    )} (${candidate.impact.type})`,
  )
  console.log(`   Confidence: ${candidate.confidence}`)

  for (const evidence of candidate.evidence) {
    console.log(`   - ${evidence}`)
  }

  console.log()
})

console.log(
  '\nRaw result:\n',
  inspect(audit, {
    depth: null,
    colors: true,
  }),
)
