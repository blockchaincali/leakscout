import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

/* eslint-disable @typescript-eslint/no-explicit-any -- lightweight browser DOM test doubles */

class FakeElement {
  attributes = new Map<string, string>()
  children: FakeElement[] = []
  listeners = new Map<string, Array<(event: any) => void>>()
  parentElement: FakeElement | null = null
  className = ''
  textContent = ''
  hidden = false
  disabled = false
  value = ''
  maxLength = 0
  rows = 0
  id = ''
  href = ''
  rel = ''
  type = ''
  htmlFor = ''
  placeholder = ''
  scrollTop = 0
  scrollHeight = 100
  style: any = {
    overflow: '', height: '', values: {} as Record<string, string>,
    setProperty(name: string, value: string) { this.values[name] = value },
  }
  dataset: Record<string, string> = {}
  shadowRoot: FakeElement | null = null
  classList = { add: (name: string) => { this.className += ` ${name}` } }

  attachShadow() {
    this.shadowRoot = new FakeElement()
    return this.shadowRoot
  }
  append(...children: FakeElement[]) {
    for (const child of children) {
      child.parentElement?.children.splice(child.parentElement.children.indexOf(child), 1)
      child.parentElement = this
      this.children.push(child)
    }
  }
  replaceChildren(...children: FakeElement[]) {
    this.children = []
    this.append(...children)
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  removeAttribute(name: string) { this.attributes.delete(name) }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  addEventListener(name: string, listener: (event: any) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }
  removeEventListener() {}
  dispatchEvent(event: any) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event)
    return true
  }
  emit(type: string, extra: Record<string, unknown> = {}) {
    this.dispatchEvent({ type, preventDefault() {}, stopPropagation() {}, ...extra })
  }
  querySelector(selector: string): FakeElement | null {
    const match = selector.startsWith('.')
      ? (element: FakeElement) => element.className.split(' ').includes(selector.slice(1))
      : () => false
    for (const child of this.children) {
      if (match(child)) return child
      const nested = child.querySelector(selector)
      if (nested) return nested
    }
    return null
  }
  focus() { (globalThis as any).document.activeElement = this }
  requestSubmit() { this.emit('submit') }
  remove() { this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1) }
}

class FakeCustomEvent {
  type: string
  detail: unknown
  bubbles: boolean
  composed: boolean
  constructor(type: string, options: any) {
    this.type = type
    this.detail = options.detail
    this.bubbles = options.bubbles
    this.composed = options.composed
  }
}

const fakeDocument = {
  body: new FakeElement(),
  documentElement: new FakeElement(),
  activeElement: null as FakeElement | null,
  createElement: () => new FakeElement(),
}
const registeredElements = new Map<string, new () => FakeElement>()
Object.defineProperties(globalThis, {
  HTMLElement: { configurable: true, value: FakeElement },
  CustomEvent: { configurable: true, value: FakeCustomEvent },
  customElements: {
    configurable: true,
    value: { get: (name: string) => registeredElements.get(name), define: (name: string, constructor: new () => FakeElement) => registeredElements.set(name, constructor) },
  },
  document: { configurable: true, value: fakeDocument },
  matchMedia: { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
})

const {
  buildRequestPayload,
  normalizeResponse,
} = await import('../../../public/embed/leakscout-assistant.js')

function makeWidget(attributes: Record<string, string> = {}) {
  const Widget = registeredElements.get('leakscout-assistant')
  assert.ok(Widget)
  const widget = new Widget() as FakeElement & Record<string, any>
  for (const [name, value] of Object.entries(attributes)) widget.setAttribute(name, value)
  widget.connectedCallback()
  return widget
}

function waitForRequest() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const widgetUrl = new URL('../../../public/embed/leakscout-assistant.js', import.meta.url)
const stylesheetUrl = new URL('../../../public/embed/leakscout-assistant.css', import.meta.url)
const landingUrl = new URL('../../../public/index.html', import.meta.url)
const pageScriptUrl = new URL('../../../public/app.js', import.meta.url)

test('public mode sends only a trimmed bounded question and normalizes public responses', () => {
  assert.deepEqual(buildRequestPayload('public', '  Explain my audit  ', [
    { role: 'assistant', content: 'must not be sent' },
  ]), { question: 'Explain my audit' })
  assert.equal(
    buildRequestPayload('public', 'q'.repeat(700)).question.length,
    500,
  )
  assert.deepEqual(normalizeResponse('public', {
    answer: '  LeakScout uses verified signals. ',
    poweredBy: 'Orbio',
  }), {
    answer: 'LeakScout uses verified signals.',
    poweredBy: true,
    inferenceUsed: true,
  })
})

test('merchant payload contains only bounded question/history and caps history at eight', () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `message ${index}`,
    privateExtra: 'must not be sent',
  }))
  const payload = buildRequestPayload('merchant', '  focus?  ', history, 99)
  assert.deepEqual(Object.keys(payload), ['question', 'history'])
  assert.equal(payload.question, 'focus?')
  assert.ok(payload.history)
  assert.equal(payload.history.length, 8)
  assert.equal(payload.history[0].content, 'message 4')
  assert.ok(payload.history.every((entry) => Object.keys(entry).length === 2))
  assert.deepEqual(buildRequestPayload('merchant', 'q', history, 0).history, [])
  assert.equal(
    buildRequestPayload('merchant', 'q'.repeat(1_200)).question.length,
    1_000,
  )
})

test('merchant normalization follows inferenceUsed and never needs to show model metadata', () => {
  assert.deepEqual(normalizeResponse('merchant', {
    status: 'ready',
    answer: 'Review availability first.',
    inferenceUsed: true,
    model: 'secret-model-name',
    poweredBy: 'Orbio',
  }), {
    answer: 'Review availability first.',
    poweredBy: true,
    inferenceUsed: true,
  })
  assert.deepEqual(normalizeResponse('merchant', {
    status: 'ready', answer: 'Deterministic guidance.', inferenceUsed: false,
  }), {
    answer: 'Deterministic guidance.',
    poweredBy: false,
    inferenceUsed: false,
  })
})

test('widget assets enforce safe rendering, private configuration boundaries and mobile behavior', async () => {
  const [script, stylesheet, landing, pageScript] = await Promise.all([
    readFile(widgetUrl, 'utf8'),
    readFile(stylesheetUrl, 'utf8'),
    readFile(landingUrl, 'utf8'),
    readFile(pageScriptUrl, 'utf8'),
  ])
  assert.match(script, /LEAKSCOUT_ASSISTANT_VERSION/)
  assert.match(script, /textContent/)
  assert.doesNotMatch(script, /innerHTML/)
  assert.doesNotMatch(script, /LEAKSCOUT_INTEGRATION_SECRET|OPENROUTER_API_KEY|Authorization\s*:/)
  assert.match(script, /credentials: this\._config\.credentials/)
  assert.match(script, /mode === 'merchant' \? 'include'/)
  assert.match(script, /new URL\('\.\.\/assets\/leakscout-favicon\.png'/)
  assert.match(script, /leakscout:open|leakscout:close|leakscout:submit|leakscout:response|leakscout:error|leakscout:demo|leakscout:audit/)
  assert.match(stylesheet, /100dvh/)
  assert.match(stylesheet, /safe-area-inset/)
  assert.match(landing, /<leakscout-assistant[\s\S]*mode="public"[\s\S]*chat-endpoint="\/api\/public\/assistant"/)
  assert.doesNotMatch(landing, /id="leakscout-chat-(?:panel|launcher)"/)
  assert.match(pageScript, /addEventListener\('leakscout:demo', runDemo\)/)
  assert.match(pageScript, /addEventListener\('leakscout:audit'/)
})

test('invalid and script-like backend answers fail safely as plain text content', () => {
  assert.throws(() => normalizeResponse('merchant', { answer: '', inferenceUsed: true }))
  const hostileText = '<img src=x onerror=alert(1)>'
  assert.equal(normalizeResponse('public', {
    answer: hostileText,
    poweredBy: 'Orbio',
  }).answer, hostileText)
})

test('opening and choosing suggestions perform no inference; submitting performs exactly one request', async () => {
  let requests = 0
  const hostileAnswer = '<img src=x onerror=alert(1)>'
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      requests += 1
      return { ok: true, json: async () => ({ answer: hostileAnswer, poweredBy: 'Orbio' }) }
    },
  })
  const widget = makeWidget()
  let opened = 0
  let demo = 0
  let audit = 0
  widget.addEventListener('leakscout:open', () => opened++)
  widget.addEventListener('leakscout:demo', () => demo++)
  widget.addEventListener('leakscout:audit', () => audit++)
  widget.open()
  assert.equal(opened, 1)
  assert.equal(fakeDocument.activeElement, widget._textarea)
  assert.equal(requests, 0)
  widget.shadowRoot?.querySelector('.suggestion')?.emit('click')
  assert.equal(requests, 0)
  widget.shadowRoot?.querySelector('.cta')?.emit('click')
  assert.equal(demo, 1)
  widget._ctaRegion.children[1]?.emit('click')
  assert.equal(audit, 1)
  assert.equal(requests, 0)

  widget.open()
  const textarea = widget.shadowRoot?.querySelector('.question')
  assert.ok(textarea)
  textarea.value = 'Can I run a demo?'
  widget.shadowRoot?.querySelector('.composer')?.emit('submit')
  await waitForRequest()
  assert.equal(requests, 1)
  assert.equal(widget._powered.hidden, false)
  const renderedAnswer = widget._conversation.children.at(-1)?.children.at(-1)
  assert.equal(renderedAnswer?.textContent, hostileAnswer)
})

test('merchant submission uses credentials include, bounded allowlisted history and safe response metadata', async () => {
  let requestOptions: any
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (_endpoint: string, options: any) => {
      requestOptions = options
      return {
        ok: true,
        json: async () => ({ status: 'ready', answer: 'Check current availability.', inferenceUsed: true, model: 'private-model' }),
      }
    },
  })
  const widget = makeWidget({ mode: 'merchant', 'chat-endpoint': '/backend/leakscout/chat' })
  widget._messages = [
    { role: 'user', content: 'Earlier question', secret: 'never forwarded' },
    { role: 'assistant', content: 'Earlier answer' },
  ]
  const responseEvents: any[] = []
  widget.addEventListener('leakscout:response', (event: any) => responseEvents.push(event.detail))
  widget.open()
  const textarea = widget.shadowRoot?.querySelector('.question')
  assert.ok(textarea)
  textarea.value = 'What should I check?'
  widget.shadowRoot?.querySelector('.composer')?.emit('submit')
  await waitForRequest()
  assert.equal(requestOptions.credentials, 'include')
  assert.deepEqual(JSON.parse(requestOptions.body), {
    question: 'What should I check?',
    history: [
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier answer' },
    ],
  })
  assert.equal(widget._powered.hidden, false)
  assert.deepEqual(Object.keys(responseEvents[0]), ['mode', 'answerLength', 'inferenceUsed', 'poweredBy'])
  assert.equal(JSON.stringify(responseEvents).includes('private-model'), false)
})

test('error UI is generic and Retry repeats only the failed explicit submission', async () => {
  const requests: string[] = []
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (_endpoint: string, options: any) => {
      requests.push(options.body)
      return requests.length === 1
        ? { ok: false, json: async () => ({ error: 'secret raw provider error' }) }
        : { ok: true, json: async () => ({ answer: 'Recovered.', inferenceUsed: false }) }
    },
  })
  const widget = makeWidget({ mode: 'merchant', 'chat-endpoint': '/backend/chat' })
  const errors: any[] = []
  widget.addEventListener('leakscout:error', (event: any) => errors.push(event.detail))
  widget.open()
  const textarea = widget.shadowRoot?.querySelector('.question')
  assert.ok(textarea)
  textarea.value = 'Retry this question'
  widget.shadowRoot?.querySelector('.composer')?.emit('submit')
  await waitForRequest()
  assert.equal(errors.length, 1)
  assert.equal(widget.shadowRoot?.textContent?.includes('secret raw provider error'), false)
  widget.shadowRoot?.querySelector('.retry')?.emit('click')
  await waitForRequest()
  assert.equal(requests.length, 2)
  assert.equal(requests[0], requests[1])
  assert.equal(widget._powered.hidden, true)
})

test('close, Escape, focus management and mobile scroll/viewport behavior work', () => {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  })
  Object.defineProperty(globalThis, 'visualViewport', {
    configurable: true,
    value: { height: 620, addEventListener() {}, removeEventListener() {} },
  })
  fakeDocument.body.style.overflow = 'auto'
  fakeDocument.documentElement.style.overflow = 'auto'
  const widget = makeWidget()
  let closes = 0
  widget.addEventListener('leakscout:close', () => closes++)
  widget.open()
  assert.equal(fakeDocument.body.style.overflow, 'hidden')
  assert.equal(fakeDocument.documentElement.style.overflow, 'hidden')
  assert.equal(widget._panel.getAttribute('aria-modal'), 'true')
  assert.equal(widget.style.values['--leakscout-viewport-height'], '620px')
  widget.emit('keydown', { key: 'Escape' })
  assert.equal(closes, 1)
  assert.equal(fakeDocument.body.style.overflow, 'auto')
  assert.equal(fakeDocument.activeElement, widget._launcher)
})
