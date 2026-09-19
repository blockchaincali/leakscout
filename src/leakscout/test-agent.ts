import { loadInventoryCsv, loadSalesCsv } from './analytics/parser.js'
import { runProfitAudit } from './analytics/audit.js'
import { formatMoney } from './analytics/utils.js'
import { runLeakScoutAgent } from './agent/leakScout.js'

const currency = process.argv[2] ?? 'NGN'

const sales = await loadSalesCsv('demo/sales.csv')
const inventory = await loadInventoryCsv('demo/inventory.csv')
const audit = runProfitAudit(sales, inventory, currency)

console.log('\nLeakScout deterministic engine complete.')
console.log(`Found ${audit.candidates.length} verified candidates.`)
console.log('Starting Orbio agent investigation...\n')

const report = await runLeakScoutAgent(audit)

console.log('=== LEAKSCOUT AGENT REPORT ===\n')
console.log(report.headline)
console.log(report.executiveSummary)

console.log('\nPRIORITIES\n')

report.priorities.forEach((priority, index) => {
  const candidate = priority.candidate

  console.log(`${index + 1}. ${candidate.title}`)
  console.log(
    `   Verified impact: ${formatMoney(
      candidate.impact.value,
      candidate.impact.currency,
    )} (${candidate.impact.type})`,
  )
  console.log(`   Why: ${priority.reasoning}`)
  console.log(`   Action: ${priority.recommendedAction}`)
  console.log(`   Urgency: ${priority.urgency}`)
  console.log()
})

console.log('ACTION PLAN')
console.log('Today:', report.actionPlan.today)
console.log('This week:', report.actionPlan.thisWeek)
console.log('Monitor:', report.actionPlan.monitor)

console.log('\nAgent metadata')
console.log('Model:', report.model)
console.log('Tools used:', report.toolCalls.join(', '))
