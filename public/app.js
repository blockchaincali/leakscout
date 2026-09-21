/* global document, window, fetch, FormData */

const form = document.querySelector('#audit-form')
const salesInput = document.querySelector('#sales-file')
const inventoryInput = document.querySelector('#inventory-file')
const salesLabel = document.querySelector('#sales-label')
const inventoryLabel = document.querySelector('#inventory-label')
const salesZone = document.querySelector('#sales-zone')
const inventoryZone = document.querySelector('#inventory-zone')
const demoCurrencyInput = document.querySelector('#demo-currency')
const demoButton = document.querySelector('#demo-button')
const demoTriggers = document.querySelectorAll('.demo-trigger')
const auditButton = document.querySelector('#audit-button')
const auditButtonLabel = document.querySelector('#audit-button-label')
const coverageNote = document.querySelector('#data-coverage-note')
const investigation = document.querySelector('#investigation')
const investigationTitle = document.querySelector('#investigation-title')
const investigationDetail = document.querySelector('#investigation-detail')
const progressBar = document.querySelector('#progress-bar')
const results = document.querySelector('#results')
const auditCard = document.querySelector('#audit-card')
const toast = document.querySelector('#toast')
const rerunButton = document.querySelector('#rerun-button')

let progressTimer = null

const currencyLocales = {
  USD: 'en-US',
  NGN: 'en-NG',
  GBP: 'en-GB',
  EUR: 'en-IE',
  GHS: 'en-GH',
  KES: 'en-KE',
  ZAR: 'en-ZA',
  CAD: 'en-CA',
  AUD: 'en-AU',
  INR: 'en-IN',
  JPY: 'ja-JP',
  AED: 'en-AE',
  SAR: 'ar-SA',
  CHF: 'de-CH',
  SGD: 'en-SG',
  NZD: 'en-NZ',
}

function money(value, currency) {
  return new Intl.NumberFormat(currencyLocales[currency] ?? undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function impactLabel(type) {
  return {
    revenue_at_risk: 'Revenue at risk',
    monthly_profit_leak: 'Monthly profit leak',
    capital_tied_up: 'Capital tied up',
    revenue_decline: 'Revenue decline',
    inventory_value_exposure: 'Inventory value',
  }[type] ?? type.replaceAll('_', ' ')
}

function categoryLabel(category) {
  return {
    stockout_risk: 'Stockout risk',
    margin_compression: 'Margin compression',
    dead_inventory: 'Dead inventory',
    sales_anomaly: 'Sales anomaly',
    inventory_exposure: 'Inventory exposure',
  }[category] ?? category
}

function urgencyLabel(value) {
  return value.replace('_', ' ')
}

function currentMode() {
  const hasSales = Boolean(
    salesInput.files?.[0],
  )

  const hasInventory = Boolean(
    inventoryInput.files?.[0],
  )

  if (hasSales && hasInventory) {
    return 'full'
  }

  if (hasSales) {
    return 'sales_only'
  }

  if (hasInventory) {
    return 'inventory_only'
  }

  return 'none'
}

function updateAuditModeUI() {
  const mode = currentMode()

  coverageNote.classList.remove(
    'full-ready',
  )

  if (mode === 'full') {
    auditButtonLabel.textContent =
      'Run full audit'

    coverageNote.innerHTML =
      '<strong>Full audit unlocked.</strong> Sales + inventory enable all detectors and the Orbio investigation.'

    coverageNote.classList.add(
      'full-ready',
    )

    return
  }

  if (mode === 'sales_only') {
    auditButtonLabel.textContent =
      'Run sales audit'

    coverageNote.innerHTML =
      '<strong>Sales-only audit ready.</strong> LeakScout can inspect margins and sales anomalies. Add inventory to unlock stockout, dead-stock and Orbio investigation.'

    return
  }

  if (mode === 'inventory_only') {
    auditButtonLabel.textContent =
      'Run inventory audit'

    coverageNote.innerHTML =
      '<strong>Inventory-only audit ready.</strong> LeakScout can assess catalogue health and quantify inventory exposure only where stock and valuation data exist. Add sales data to unlock deeper investigation.'

    return
  }

  auditButtonLabel.textContent =
    'Run profit audit'

  coverageNote.innerHTML =
    '<strong>One dataset works.</strong> Add both to unlock the full Orbio investigation.'
}

function progressSteps(mode) {
  if (mode === 'inventory_only') {
    return [
      {
        title: 'Validating inventory data…',
        detail:
          'Checking SKUs, stock levels and inventory costs.',
        width: 24,
      },
      {
        title: 'Measuring inventory exposure…',
        detail:
          'Calculating measurable cost or retail-value concentration without mixing the two.',
        width: 62,
      },
      {
        title: 'Preparing limited audit…',
        detail:
          'Sales history was not supplied, so no inference will be spent.',
        width: 92,
      },
    ]
  }

  if (mode === 'sales_only') {
    return [
      {
        title: 'Validating sales data…',
        detail:
          'Checking transaction structure and financial fields.',
        width: 22,
      },
      {
        title: 'Analysing sales patterns…',
        detail:
          'Looking for unusual revenue movement.',
        width: 54,
      },
      {
        title: 'Measuring margin leakage…',
        detail:
          'Comparing recent unit economics against prior performance.',
        width: 78,
      },
      {
        title: 'Preparing limited audit…',
        detail:
          'Inventory context was not supplied, so no inference will be spent.',
        width: 94,
      },
    ]
  }

  return [
    {
      title: 'Validating merchant data…',
      detail:
        'Checking file structure and financial fields.',
      width: 16,
    },
    {
      title: 'Analysing sales patterns…',
      detail:
        'Looking for unusual revenue movement and product velocity.',
      width: 36,
    },
    {
      title: 'Checking inventory exposure…',
      detail:
        'Quantifying stockout risk and trapped working capital.',
      width: 58,
    },
    {
      title: 'Measuring margin leakage…',
      detail:
        'Comparing recent unit economics against prior performance.',
      width: 76,
    },
    {
      title: 'Orbio is prioritizing verified signals…',
      detail:
        'The agent is deciding which findings deserve attention first.',
      width: 94,
    },
  ]
}

function showToast(message) {
  toast.textContent = message
  toast.classList.remove('hidden')

  window.setTimeout(() => {
    toast.classList.add('hidden')
  }, 5000)
}

function startProgress(mode) {
  const steps = progressSteps(mode)
  let step = 0

  function render() {
    const current =
      steps[
        Math.min(
          step,
          steps.length - 1,
        )
      ]

    investigationTitle.textContent =
      current.title

    investigationDetail.textContent =
      current.detail

    progressBar.style.width =
      `${current.width}%`

    if (step < steps.length - 1) {
      step += 1
    }
  }

  render()

  progressTimer =
    window.setInterval(
      render,
      850,
    )
}

function stopProgress() {
  if (progressTimer) {
    window.clearInterval(
      progressTimer,
    )

    progressTimer = null
  }

  progressBar.style.width = '100%'
}

function setBusy(
  value,
  mode = 'full',
) {
  auditButton.disabled = value
  demoButton.disabled = value
  for (const trigger of demoTriggers) {
    trigger.disabled = value
  }

  if (value) {
    results.classList.add('hidden')
    investigation.classList.remove(
      'hidden',
    )
    startProgress(mode)
  } else {
    stopProgress()
  }
}

function updateFileLabel(
  input,
  label,
  zone,
) {
  const file = input.files?.[0]

  if (file) {
    label.textContent =
      `✓ ${file.name}`

    zone.classList.add('active')
  } else {
    zone.classList.remove(
      'active',
    )
  }

  updateAuditModeUI()
}

salesInput.addEventListener(
  'change',
  () => {
    updateFileLabel(
      salesInput,
      salesLabel,
      salesZone,
    )
  },
)

inventoryInput.addEventListener(
  'change',
  () => {
    updateFileLabel(
      inventoryInput,
      inventoryLabel,
      inventoryZone,
    )
  },
)


async function requestJson(
  url,
  options,
) {
  const response =
    await fetch(url, options)

  const payload =
    await response
      .json()
      .catch(() => ({}))

  if (!response.ok) {
    throw new Error(
      payload.error ??
        `Request failed with status ${response.status}`,
    )
  }

  return payload
}

function clearChildren(node) {
  while (node.firstChild) {
    node.removeChild(
      node.firstChild,
    )
  }
}

function metricCard(
  value,
  label,
) {
  const card =
    document.createElement('div')

  card.className = 'metric'

  const strong =
    document.createElement('strong')

  strong.textContent = value

  const span =
    document.createElement('span')

  span.textContent = label

  card.append(strong, span)

  return card
}

function unavailableMetric(label, requirement) {
  return metricCard('Not available', `${label} · ${requirement}`)
}

function totalsForCandidates(
  candidates,
) {
  const totals = {
    revenue_at_risk: 0,
    monthly_profit_leak: 0,
    capital_tied_up: 0,
    revenue_decline: 0,
    inventory_value_exposure: 0,
  }

  for (const candidate of candidates) {
    if (
      candidate.impact.type in
      totals
    ) {
      totals[
        candidate.impact.type
      ] += candidate.impact.value
    }
  }

  return totals
}

function renderMetrics(payload) {
  const grid =
    document.querySelector(
      '#metrics-grid',
    )

  clearChildren(grid)

  const currency =
    payload.audit.summary.currency

  const totals =
    totalsForCandidates(
      payload.audit.candidates,
    )

  if (
    payload.dataMode ===
    'inventory_only'
  ) {
    const quality =
      payload.audit.summary
        .inventoryDataQuality

    if (
      quality &&
      quality.stockKnown === 0
    ) {
      grid.append(
        metricCard(
          String(
            quality.totalRows,
          ),
          'Products imported',
        ),

        metricCard(
          `${quality.stockKnown}/${quality.totalRows}`,
          'Stock quantities available',
        ),

        metricCard(
          `${quality.unitCostKnown}/${quality.totalRows}`,
          'Unit costs available',
        ),

        metricCard(
          `${quality.sellingPriceKnown}/${quality.totalRows}`,
          'Selling prices available',
        ),
      )

      return
    }

    const costValue = payload.audit.summary.inventoryValue
    const retailValue = payload.audit.summary.retailInventoryValue
    const largest = payload.audit.candidates[0]

    grid.append(
      costValue !== undefined
        ? metricCard(money(costValue, currency), 'Inventory value at unit cost')
        : retailValue !== undefined
          ? metricCard(money(retailValue, currency), 'Retail-value exposure · not capital cost')
          : unavailableMetric('Inventory value', 'Requires stock quantities and unit cost'),

      largest
        ? metricCard(
            money(largest.impact.value, currency),
            largest.metadata?.valuationBasis === 'retail'
              ? 'Largest retail-value holding'
              : 'Largest cost-basis holding',
          )
        : unavailableMetric('Largest holding', 'Requires measurable stock value'),

      metricCard(
        String(
          payload.audit.summary
            .products,
        ),
        'Products analysed',
      ),

      metricCard(`${quality?.readinessPercent ?? 0}%`, 'Data readiness'),
    )

    return
  }

  if (
    payload.dataMode ===
    'sales_only'
  ) {
    const salesQuality = payload.audit.summary.salesDataQuality
    const hasCosts = (salesQuality?.unitCostKnown ?? 0) > 0
    const hasAnomalyWindow = payload.audit.summary.periodDays >= 35

    grid.append(
      metricCard(
        money(
          payload.audit.summary
            .revenue,
          currency,
        ),
        'Revenue analysed',
      ),

      hasCosts
        ? metricCard(money(totals.monthly_profit_leak, currency), 'Monthly profit leakage')
        : unavailableMetric('Monthly profit leakage', 'Requires unit cost'),

      hasAnomalyWindow
        ? metricCard(money(totals.revenue_decline, currency), 'Recent revenue decline')
        : unavailableMetric('Revenue trend', 'Requires at least 35 days'),

      metricCard(
        String(
          payload.audit.summary
            .products,
        ),
        'Products analysed',
      ),
    )

    return
  }

  const quality = payload.audit.summary.inventoryDataQuality
  const salesQuality = payload.audit.summary.salesDataQuality
  const stockoutReady = (quality?.stockAndLeadTimeKnown ?? 0) > 0
  const marginReady = (salesQuality?.unitCostKnown ?? 0) > 0
  const deadStockReady = (quality?.stockAndCostKnown ?? 0) > 0 && payload.audit.summary.periodDays >= 45
  const anomalyReady = payload.audit.summary.periodDays >= 35

  grid.append(
    stockoutReady ? metricCard(money(totals.revenue_at_risk, currency), 'Revenue at risk') : unavailableMetric('Revenue at risk', 'Requires stock and lead time'),
    marginReady ? metricCard(money(totals.monthly_profit_leak, currency), 'Monthly profit leakage') : unavailableMetric('Profit leakage', 'Requires unit cost'),
    deadStockReady ? metricCard(money(totals.capital_tied_up, currency), 'Capital tied up') : unavailableMetric('Capital tied up', 'Requires cost, stock and 45+ days'),
    anomalyReady ? metricCard(money(totals.revenue_decline, currency), 'Recent revenue decline') : unavailableMetric('Revenue trend', 'Requires at least 35 days'),
  )
}

function renderPriorities(payload) {
  const list =
    document.querySelector(
      '#priority-list',
    )

  clearChildren(list)

  if (
    !payload.report.priorities
      .length
  ) {
    const empty =
      document.createElement('div')

    empty.className =
      'priority-card'

    empty.textContent =
      'No material signals were found above the current thresholds.'

    list.append(empty)
    return
  }

  payload.report.priorities.forEach(
    (priority, index) => {
      const card =
        document.createElement(
          'article',
        )

      card.className =
        'priority-card'

      const top =
        document.createElement(
          'div',
        )

      top.className =
        'priority-top'

      const left =
        document.createElement(
          'div',
        )

      const number =
        document.createElement(
          'span',
        )

      number.className =
        'priority-number'

      number.textContent =
        `0${index + 1}`

      const title =
        document.createElement(
          'h4',
        )

      title.textContent =
        priority.candidate.title

      const urgency =
        document.createElement(
          'span',
        )

      urgency.className =
        `urgency ${priority.urgency}`

      urgency.textContent =
        urgencyLabel(
          priority.urgency,
        )

      left.append(
        number,
        title,
        urgency,
      )

      const right =
        document.createElement(
          'div',
        )

      const impact =
        document.createElement(
          'div',
        )

      impact.className =
        'impact-value'

      impact.textContent =
        money(
          priority.candidate
            .impact.value,
          priority.candidate
            .impact.currency,
        )

      const impactType =
        document.createElement(
          'span',
        )

      impactType.className =
        'impact-type'

      impactType.textContent =
        impactLabel(
          priority.candidate
            .impact.type,
        )

      right.append(
        impact,
        impactType,
      )

      top.append(left, right)

      const evidence =
        document.createElement(
          'div',
        )

      evidence.className =
        'evidence'

      evidence.textContent =
        priority.candidate.evidence.join(' · ')

      const recommendation =
        document.createElement(
          'div',
        )

      recommendation.className =
        'recommendation'

      const label =
        document.createElement(
          'span',
        )

      label.textContent =
        'RECOMMENDED ACTION'

      const action =
        document.createElement(
          'div',
        )

      action.textContent =
        priority.recommendedAction

      recommendation.append(
        label,
        action,
      )

      const detailGroups = [
        {
          label: 'Why this matters',
          items: [priority.whyItMatters, priority.reasoning].filter(Boolean),
        },
        {
          label: 'What to check',
          items: priority.checksToPerform ?? [],
        },
        {
          label: 'Unknowns / limitations',
          items: priority.assumptionsOrUnknowns ?? [],
        },
      ]
      const detailsContainer = document.createElement('div')
      detailsContainer.className = 'priority-details-list'

      for (const group of detailGroups) {
        if (!group.items.length) continue

        const details = document.createElement('details')
        details.className = 'priority-details'

        const summary = document.createElement('summary')
        summary.textContent = group.label
        details.append(summary)

        const content = document.createElement('div')
        content.className = 'priority-details-content'
        for (const item of group.items) {
          const line = document.createElement('p')
          line.textContent = item
          content.append(line)
        }
        details.append(content)
        detailsContainer.append(details)
      }

      card.append(
        top,
        evidence,
        recommendation,
        detailsContainer,
      )

      list.append(card)
    },
  )
}

function renderInventoryHealth(payload) {
  const list =
    document.querySelector(
      '#priority-list',
    )

  clearChildren(list)

  const insights =
    payload.audit
      .inventoryInsights ?? []

  if (!insights.length) {
    const empty =
      document.createElement(
        'div',
      )

    empty.className =
      'priority-card'

    empty.textContent =
      'No additional inventory-health insights could be calculated from the available fields.'

    list.append(empty)
    return
  }

  insights.forEach(
    (insight, index) => {
      const card =
        document.createElement(
          'article',
        )

      card.className =
        'priority-card'

      const top =
        document.createElement(
          'div',
        )

      top.className =
        'priority-top'

      const left =
        document.createElement(
          'div',
        )

      const number =
        document.createElement(
          'span',
        )

      number.className =
        'priority-number'

      number.textContent =
        `0${index + 1}`

      const title =
        document.createElement(
          'h4',
        )

      title.textContent =
        insight.title

      const severity =
        document.createElement(
          'span',
        )

      const urgencyClass =
        insight.severity ===
        'high'
          ? 'today'
          : insight.severity ===
              'medium'
            ? 'this_week'
            : 'monitor'

      severity.className =
        `urgency ${urgencyClass}`

      severity.textContent =
        insight.severity

      left.append(
        number,
        title,
        severity,
      )

      top.append(left)

      if (insight.metric) {
        const metric =
          document.createElement(
            'div',
          )

        metric.className =
          'inventory-insight-metric'

        const value =
          document.createElement(
            'strong',
          )

        value.textContent =
          insight.metric.value

        const label =
          document.createElement(
            'span',
          )

        label.textContent =
          insight.metric.label

        metric.append(
          value,
          label,
        )

        top.append(metric)
      }

      const evidence =
        document.createElement(
          'div',
        )

      evidence.className =
        'evidence'

      evidence.textContent =
        insight.evidence.join(
          ' · ',
        )

      const recommendation =
        document.createElement(
          'div',
        )

      recommendation.className =
        'recommendation'

      const label =
        document.createElement(
          'span',
        )

      label.textContent =
        'NEXT STEP'

      const action =
        document.createElement(
          'div',
        )

      action.textContent =
        insight.action

      recommendation.append(
        label,
        action,
      )

      card.append(
        top,
        evidence,
        recommendation,
      )

      list.append(card)
    },
  )
}

function renderActions(payload) {
  const wrapper =
    document.querySelector(
      '#action-groups',
    )

  clearChildren(wrapper)

  const groups = [
    [
      'TODAY',
      payload.report.actionPlan
        .today,
    ],
    [
      'THIS WEEK',
      payload.report.actionPlan
        .thisWeek,
    ],
    [
      'MONITOR',
      payload.report.actionPlan
        .monitor,
    ],
  ]

  for (
    const [name, items]
    of groups
  ) {
    if (!items?.length) continue

    const group =
      document.createElement(
        'div',
      )

    group.className =
      'action-group'

    const title =
      document.createElement(
        'strong',
      )

    title.textContent = name

    const list =
      document.createElement(
        'ul',
      )

    for (const item of items) {
      const li =
        document.createElement(
          'li',
        )

      li.textContent = item
      list.append(li)
    }

    group.append(
      title,
      list,
    )

    wrapper.append(group)
  }
}

function renderSignals(payload) {
  const list =
    document.querySelector(
      '#signal-list',
    )

  clearChildren(list)

  for (
    const candidate
    of payload.audit.candidates
  ) {
    const row =
      document.createElement(
        'div',
      )

    row.className =
      'signal-row'

    const left =
      document.createElement(
        'div',
      )

    const strong =
      document.createElement(
        'strong',
      )

    strong.textContent =
      candidate.title

    const small =
      document.createElement(
        'span',
      )

    small.textContent =
      categoryLabel(
        candidate.category,
      )

    left.append(
      strong,
      document.createElement(
        'br',
      ),
      small,
    )

    const value =
      document.createElement(
        'strong',
      )

    value.textContent =
      money(
        candidate.impact.value,
        candidate.impact.currency,
      )

    row.append(
      left,
      value,
    )

    list.append(row)
  }
}

function renderCoverage(payload) {
  const banner =
    document.querySelector(
      '#coverage-banner',
    )

  if (
    !payload.coverage
      ?.limitations?.length
  ) {
    banner.classList.add(
      'hidden',
    )
    banner.textContent = ''
    return
  }

  banner.classList.remove(
    'hidden',
  )

  clearChildren(banner)

  const heading =
    document.createElement(
      'strong',
    )

  heading.textContent =
    'Limited audit'

  const body =
    document.createElement(
      'div',
    )

  body.textContent =
    payload.coverage.limitations.join(
      ' ',
    )

  banner.append(
    heading,
    body,
  )
}

function renderResult(payload) {
  document.querySelector(
    '#report-headline',
  ).textContent =
    payload.report.headline

  document.querySelector(
    '#report-summary',
  ).textContent =
    payload.report.executiveSummary

  const status =
    document.querySelector(
      '#agent-status',
    )

  if (
    payload.agentStatus ===
    'completed'
  ) {
    status.textContent =
      '● Orbio investigation complete'
  } else if (
    payload.agentStatus ===
    'insufficient_context'
  ) {
    status.textContent =
      '● Limited audit · no inference spent'
  } else if (
    payload.agentStatus ===
    'not_needed'
  ) {
    status.textContent =
      '● No inference needed'
  } else {
    status.textContent =
      '● Deterministic fallback'
  }

  renderCoverage(payload)
  renderMetrics(payload)

  const priorityKicker =
    document.querySelector(
      '#priority-kicker',
    )

  const priorityHeading =
    document.querySelector(
      '#priority-heading',
    )

  if (
    payload.dataMode ===
    'inventory_only'
  ) {
    priorityKicker.textContent =
      'INVENTORY HEALTH'

    priorityHeading.textContent =
      'What this data reveals'

    renderInventoryHealth(
      payload,
    )
  } else {
    priorityKicker.textContent =
      'PRIORITIES'

    priorityHeading.textContent =
      'What needs attention'

    renderPriorities(payload)
  }

  renderActions(payload)
  renderSignals(payload)

  const decisionPanel =
    document.querySelector(
      '#investigation-decision',
    )

  if (payload.dataMode === 'full') {
    const decisionLabels = {
      completed: {
        inference: 'Activated',
        agent: 'Complete',
      },
      not_needed: {
        inference: 'Not needed',
        agent: 'Not needed',
      },
      fallback: {
        inference: 'Fallback activated',
        agent: 'Fallback activated',
      },
      insufficient_context: {
        inference: 'Insufficient context',
        agent: 'Insufficient context',
      },
    }

    const decision =
      decisionLabels[
        payload.agentStatus
      ] ?? decisionLabels.fallback

    document.querySelector(
      '#decision-signals',
    ).textContent = String(
      payload.audit.candidates.length,
    )

    document.querySelector(
      '#decision-inference',
    ).textContent = decision.inference

    document.querySelector(
      '#decision-provider',
    ).textContent = payload.poweredBy

    document.querySelector(
      '#decision-agent',
    ).textContent = decision.agent

    decisionPanel.classList.remove(
      'hidden',
    )
  } else {
    decisionPanel.classList.add(
      'hidden',
    )
  }

  const traceList = document.querySelector('#trace-model')
  clearChildren(traceList)
  const stageLabels = {
    scout: 'Scout',
    investigator: 'Deep investigation',
    critic: 'Verification',
  }
  const modelNames = {
    'google/gemini-3.8-flash': 'Gemini 3.8 Flash',
    'anthropic/claude-sonnet-5': 'Claude Sonnet 5',
    'openai/gpt-6-astra': 'GPT-6 Astra',
  }
  const trace = payload.report.modelTrace ?? []

  if (trace.length) {
    for (const stage of trace) {
      const item = document.createElement('div')
      item.className = 'trace-stage'

      const role = document.createElement('span')
      role.textContent = stageLabels[stage.role] ?? stage.role

      const model = document.createElement('strong')
      model.textContent = modelNames[stage.model] ?? stage.model

      item.append(role, model)
      traceList.append(item)
    }
  } else {
    traceList.textContent = 'Deterministic result · no inference stages completed'
  }

  document.querySelector(
    '#trace-tools',
  ).textContent =
    payload.report.toolCalls.length
      ? `Tools: ${payload.report.toolCalls.join(', ')}`
      : 'No agent tools invoked'

  investigation.classList.add(
    'hidden',
  )

  results.classList.remove(
    'hidden',
  )

  results.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}

async function runDemo() {
  const currency =
    demoCurrencyInput?.value ||
    'USD'

  setBusy(true, 'full')

  try {
    const payload =
      await requestJson(
        '/api/demo',
        {
          method: 'POST',
          headers: {
            'content-type':
              'application/json',
          },
          body: JSON.stringify({ currency }),
        },
      )

    renderResult(payload)
  } catch (error) {
    investigation.classList.add(
      'hidden',
    )

    showToast(
      error instanceof Error
        ? error.message
        : 'Demo audit failed.',
    )
  } finally {
    setBusy(false)
  }
}

async function runUploadAudit(
  event,
) {
  event.preventDefault()

  const sales =
    salesInput.files?.[0]

  const inventory =
    inventoryInput.files?.[0]

  if (!sales && !inventory) {
    showToast(
      'Add at least one CSV: sales or inventory.',
    )
    return
  }

  const mode = currentMode()

  const body = new FormData()

  if (sales) {
    body.append(
      'sales',
      sales,
    )
  }

  if (inventory) {
    body.append(
      'inventory',
      inventory,
    )
  }

  body.append(
    "sourceCurrency",
    "USD",
  )

  setBusy(true, mode)

  try {
    const payload =
      await requestJson(
        '/api/audit',
        {
          method: 'POST',
          body,
        },
      )

    renderResult(payload)
  } catch (error) {
    investigation.classList.add(
      'hidden',
    )

    showToast(
      error instanceof Error
        ? error.message
        : 'Profit audit failed.',
    )
  } finally {
    setBusy(false)
  }
}

form.addEventListener(
  'submit',
  runUploadAudit,
)

demoButton.addEventListener('click', runDemo)

for (const trigger of demoTriggers) {
  trigger.addEventListener('click', runDemo)
}

rerunButton.addEventListener(
  'click',
  () => {
    results.classList.add(
      'hidden',
    )

    auditCard.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  },
)

updateAuditModeUI()


// ── Public Ask LeakScout assistant ───────────────────────────────────────────

const assistantLauncher = document.querySelector('#leakscout-chat-launcher')
const assistantPanel = document.querySelector('#leakscout-chat-panel')
const assistantClose = document.querySelector('#assistant-close')
const assistantForm = document.querySelector('#assistant-form')
const assistantQuestion = document.querySelector('#assistant-question')
const assistantSend = document.querySelector('#assistant-send')
const assistantBody = document.querySelector('#assistant-body')
const assistantSuggestions = document.querySelectorAll('#assistant-suggestions button')

function setAssistantOpen(open) {
  assistantPanel.classList.toggle('hidden', !open)
  assistantLauncher.setAttribute('aria-expanded', String(open))

  if (open) {
    window.setTimeout(() => {
      if (!assistantPanel.classList.contains('hidden')) {
        assistantQuestion.focus()
      }
    }, 80)
  } else {
    assistantLauncher.focus()
  }
}

function appendAssistantMessage(role, content) {
  const wrapper = document.createElement('div')
  wrapper.className =
    role === 'user'
      ? 'assistant-message assistant-message-user'
      : 'assistant-message assistant-message-ai'

  if (role === 'assistant') {
    const label = document.createElement('strong')
    label.textContent = 'LeakScout'
    wrapper.append(label)
  }

  const text = document.createElement('p')
  text.textContent = content
  wrapper.append(text)

  assistantBody.append(wrapper)
  assistantBody.scrollTop = assistantBody.scrollHeight
}

assistantLauncher?.addEventListener('click', () => {
  setAssistantOpen(assistantPanel.classList.contains('hidden'))
})

assistantClose?.addEventListener('click', () => {
  setAssistantOpen(false)
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !assistantPanel?.classList.contains('hidden')) {
    setAssistantOpen(false)
  }
})

for (const cta of document.querySelectorAll('.assistant-cta')) {
  cta.addEventListener('click', () => setAssistantOpen(false))
}

for (const suggestion of assistantSuggestions) {
  suggestion.addEventListener('click', () => {
    assistantQuestion.value = suggestion.textContent ?? ''
    assistantQuestion.focus()
  })
}

assistantQuestion?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    assistantForm.requestSubmit()
  }
})

assistantForm?.addEventListener('submit', async (event) => {
  event.preventDefault()

  const question = assistantQuestion.value.trim()

  if (!question || assistantSend.disabled) return

  appendAssistantMessage('user', question)

  assistantQuestion.value = ''
  assistantSend.disabled = true
  assistantBody.setAttribute('aria-busy', 'true')

  const thinking = document.createElement('div')
  thinking.className = 'assistant-message assistant-message-ai'
  thinking.textContent = 'LeakScout is thinking…'
  assistantBody.append(thinking)
  assistantBody.scrollTop = assistantBody.scrollHeight

  try {
    const response = await fetch('/api/public/assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question }),
    })

    const payload = await response.json().catch(() => ({}))

    thinking.remove()

    if (!response.ok) {
      throw new Error(
        payload.error ??
          'LeakScout could not answer right now.',
      )
    }

    if (typeof payload.answer !== 'string' || !payload.answer.trim()) {
      throw new Error('LeakScout could not answer right now.')
    }

    appendAssistantMessage('assistant', payload.answer)
  } catch (error) {
    thinking.remove()

    appendAssistantMessage(
      'assistant',
      error instanceof Error
        ? error.message
        : 'LeakScout could not answer right now.',
    )
  } finally {
    assistantSend.disabled = false
    assistantBody.removeAttribute('aria-busy')
    if (!assistantPanel.classList.contains('hidden')) {
      assistantQuestion.focus()
    }
  }
})


// Close mobile navigation after selection
const mobileMenu = document.querySelector(".mobile-menu")

for (const link of document.querySelectorAll(".mobile-menu nav a")) {
  link.addEventListener("click", () => {
    if (mobileMenu) mobileMenu.open = false
  })
}


// Premium mobile navigation state
const premiumMobileMenu = document.querySelector(".mobile-menu")

premiumMobileMenu?.addEventListener("toggle", () => {
  document.body.classList.toggle(
    "mobile-nav-open",
    premiumMobileMenu.open,
  )
})
