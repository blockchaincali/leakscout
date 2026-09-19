import { inspect } from 'node:util'
import { loadInventoryCsv, loadSalesCsv } from './analytics/parser.js'
import { runProfitAudit } from './analytics/audit.js'

const sales = await loadSalesCsv('demo/sales.csv')
const inventory = await loadInventoryCsv('demo/inventory.csv')

const audit = runProfitAudit(sales, inventory)

console.log('\n=== LEAKSCOUT LOCAL AUDIT ===\n')
console.log(
  `Transactions: ${audit.summary.transactions}`,
)
console.log(`Products analyzed: ${audit.summary.products}`)
console.log(`Period: ${audit.summary.periodDays} days`)
console.log(
  `Revenue: ₦${audit.summary.revenue.toLocaleString('en-NG')}`,
)

console.log('\n=== CANDIDATES ===\n')

audit.candidates.forEach((candidate, index) => {
  console.log(`${index + 1}. ${candidate.title}`)
  console.log(
    `   Impact: ₦${candidate.impact.value.toLocaleString('en-NG')} (${candidate.impact.type})`,
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
