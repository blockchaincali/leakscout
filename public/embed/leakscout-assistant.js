/* global URL, document, CustomEvent, AbortController, fetch, customElements */

export const LEAKSCOUT_ASSISTANT_VERSION = '1.0.0'

const PUBLIC_DEFAULTS = {
  title: 'Ask LeakScout',
  kicker: 'PRODUCT ASSISTANT',
  subtitle: 'Ask about profit leaks, demo audits and how LeakScout works.',
  suggestions: [
    'What does LeakScout do?',
    'What profit leaks can you detect?',
    'How does Orbio power LeakScout?',
    'Can I try it without my own data?',
  ],
}

const MERCHANT_DEFAULTS = {
  title: 'Ask LeakScout',
  kicker: 'BUSINESS ASSISTANT',
  subtitle: 'Grounded in your latest verified business signals.',
  suggestions: [
    'What should I focus on today?',
    'Explain these findings simply.',
    'Why was this product flagged?',
    'What should I watch this week?',
  ],
}

const SAFE_ERROR = "LeakScout couldn't answer that right now."
const MAX_HISTORY_MESSAGES = 8
const MAX_HISTORY_CONTENT = 1_000
const MAX_MERCHANT_QUESTION = 1_000
const MAX_PUBLIC_QUESTION = 500
const HTMLElementBase = globalThis.HTMLElement ?? class {}

export function buildRequestPayload(mode, question, history = [], maxHistory = 8) {
  const limit = mode === 'public' ? MAX_PUBLIC_QUESTION : MAX_MERCHANT_QUESTION
  const safeQuestion = String(question ?? '').trim().slice(0, limit)
  if (mode !== 'merchant') return { question: safeQuestion }

  const historyLimit = Math.max(0, Math.min(MAX_HISTORY_MESSAGES, Number(maxHistory) || 0))
  const boundedHistory = history
      .filter((message) =>
        message && ['user', 'assistant'].includes(message.role) &&
        typeof message.content === 'string',
      )
      .slice(-historyLimit)
  return {
    question: safeQuestion,
    history: (historyLimit === 0 ? [] : boundedHistory).map(({ role, content }) => ({
        role,
        content: content.trim().slice(0, MAX_HISTORY_CONTENT),
      })),
  }
}

export function normalizeResponse(mode, payload) {
  if (!payload || typeof payload.answer !== 'string' || !payload.answer.trim()) {
    throw new Error(SAFE_ERROR)
  }
  const inferenceUsed = mode === 'public'
    ? payload.poweredBy === 'Orbio'
    : payload.inferenceUsed === true
  return {
    answer: payload.answer.trim(),
    poweredBy: inferenceUsed,
    inferenceUsed,
  }
}

function validEndpoint(value) {
  if (!value || value.length > 2_048) return false
  try {
    const url = new URL(value, globalThis.location?.href ?? 'https://leakscout.invalid/')
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

function parseSuggestions(value, fallback) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim().slice(0, 100))
      .filter(Boolean)
      .slice(0, 8)
  }
  if (typeof value !== 'string') return [...fallback]
  try {
    return parseSuggestions(JSON.parse(value), fallback)
  } catch {
    return [...fallback]
  }
}

function node(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

export class LeakScoutAssistant extends HTMLElementBase {
  static get observedAttributes() {
    return [
      'mode', 'chat-endpoint', 'position', 'theme', 'accent', 'title',
      'subtitle', 'launcher-label', 'max-history', 'suggestions', 'kicker',
      'credentials', 'show-ctas',
    ]
  }

  constructor() {
    super()
    this._messages = []
    this._hasConversation = false
    this._pending = null
    this._busy = false
    this._requestGeneration = 0
    this._isOpen = false
    this._previousBodyOverflow = ''
    this._mobileQuery = globalThis.matchMedia?.('(max-width: 620px)') ?? null
    this._viewportHandler = () => this._syncViewport()
    if (typeof this.attachShadow !== 'function') return
    this.attachShadow({ mode: 'open' })
    this._build()
    this._configure()
  }

  connectedCallback() {
    this._configure()
    this._syncViewport()
    globalThis.visualViewport?.addEventListener('resize', this._viewportHandler)
    globalThis.visualViewport?.addEventListener('scroll', this._viewportHandler)
    this._mobileQuery?.addEventListener?.('change', this._viewportHandler)
    this._onKeydown = (event) => {
      if (event.key === 'Escape' && this._isOpen) {
        event.stopPropagation()
        this.close()
      }
    }
    this.addEventListener('keydown', this._onKeydown)
  }

  disconnectedCallback() {
    this._requestController?.abort()
    this._requestGeneration += 1
    globalThis.visualViewport?.removeEventListener('resize', this._viewportHandler)
    globalThis.visualViewport?.removeEventListener('scroll', this._viewportHandler)
    this._mobileQuery?.removeEventListener?.('change', this._viewportHandler)
    this.removeEventListener('keydown', this._onKeydown)
    this._unlockPageScroll()
  }

  attributeChangedCallback() {
    this._configure()
  }

  set suggestions(value) {
    this._suggestionsProperty = Array.isArray(value) ? [...value] : []
    this._configure()
  }

  get suggestions() {
    return [...(this._config?.suggestions ?? [])]
  }

  _build() {
    const root = this.shadowRoot
    const stylesheet = node('link')
    stylesheet.rel = 'stylesheet'
    stylesheet.href = new URL('./leakscout-assistant.css', import.meta.url).href
    root.append(stylesheet)

    this._launcher = node('button', 'launcher')
    this._launcher.type = 'button'
    this._launcher.setAttribute('aria-expanded', 'false')
    this._launcher.setAttribute('aria-controls', 'assistant-panel')
    this._launcher.addEventListener('click', () => this._isOpen ? this.close() : this.open())
    const tooltip = node('span', 'tooltip')
    tooltip.setAttribute('role', 'tooltip')
    this._monogram = node('img', 'monogram')
    this._monogram.src = new URL('../assets/leakscout-favicon.png', import.meta.url).href
    this._monogram.alt = ''
    const online = node('span', 'online-dot')
    online.setAttribute('aria-hidden', 'true')
    this._launcher.append(tooltip, this._monogram, online)

    this._panel = node('section', 'panel')
    this._panel.id = 'assistant-panel'
    this._panel.hidden = true
    this._panel.setAttribute('role', 'dialog')
    this._panel.setAttribute('aria-modal', 'false')
    this._panel.setAttribute('aria-labelledby', 'assistant-title')

    const header = node('header', 'header')
    const intro = node('div', 'intro')
    this._kicker = node('span', 'kicker')
    this._title = node('h2', '', 'Ask LeakScout')
    this._title.id = 'assistant-title'
    this._subtitle = node('p', 'subtitle')
    intro.append(this._kicker, this._title, this._subtitle)
    this._close = node('button', 'close', '×')
    this._close.type = 'button'
    this._close.setAttribute('aria-label', 'Close Ask LeakScout')
    this._close.addEventListener('click', () => this.close())
    header.append(intro, this._close)

    this._conversation = node('div', 'conversation')
    this._conversation.setAttribute('aria-live', 'polite')
    this._conversation.setAttribute('aria-relevant', 'additions text')
    this._greeting = node('div', 'message assistant-message')
    this._greeting.append(node('strong', '', 'LeakScout'))
    this._greetingText = node('p')
    this._greeting.append(this._greetingText)
    this._suggestionRegion = node('div', 'suggestions')
    this._suggestionRegion.setAttribute('aria-label', 'Suggested questions')
    this._ctaRegion = node('div', 'cta-row')
    this._conversation.append(this._greeting, this._suggestionRegion, this._ctaRegion)

    this._retry = node('button', 'retry', 'Retry')
    this._retry.type = 'button'
    this._retry.hidden = true
    this._retry.addEventListener('click', () => this._submitPending())

    const form = node('form', 'composer')
    const label = node('label', 'sr-only', 'Ask LeakScout a question')
    label.htmlFor = 'question'
    this._textarea = node('textarea', 'question')
    this._textarea.id = 'question'
    this._textarea.maxLength = MAX_MERCHANT_QUESTION
    this._textarea.rows = 1
    this._textarea.placeholder = 'Ask LeakScout a question…'
    this._textarea.addEventListener('input', () => this._resizeTextarea())
    this._textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        form.requestSubmit()
      }
    })
    this._send = node('button', 'send', '↑')
    this._send.type = 'submit'
    this._send.setAttribute('aria-label', 'Send question')
    form.append(label, this._textarea, this._send)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      this._startSubmission(this._textarea.value)
    })

    this._powered = node('div', 'powered')
    this._powered.hidden = true
    this._powered.append(node('span', 'powered-dot'), node('span', '', 'Powered by Orbio'))
    this._panel.append(header, this._conversation, this._retry, form, this._powered)
    this.shadowRoot.append(this._launcher, this._panel)
  }

  _configure() {
    if (!this._panel) return
    const mode = this.getAttribute('mode') === 'merchant' ? 'merchant' : 'public'
    if (this._config && this._config.mode !== mode) {
      this._requestController?.abort()
      this._requestGeneration += 1
      this._busy = false
      this._pending = null
      this._messages = []
      this._hasConversation = false
      this._conversation.replaceChildren(this._greeting, this._suggestionRegion, this._ctaRegion)
      this._powered.hidden = true
      this._retry.hidden = true
    }
    const defaults = mode === 'public' ? PUBLIC_DEFAULTS : MERCHANT_DEFAULTS
    const endpoint = this.getAttribute('chat-endpoint') || (mode === 'public' ? '/api/public/assistant' : '')
    const position = ['bottom-right', 'bottom-left'].includes(this.getAttribute('position'))
      ? this.getAttribute('position')
      : 'bottom-right'
    const theme = this.getAttribute('theme') === 'dark' ? 'dark' : 'light'
    const parsedHistory = Number.parseInt(this.getAttribute('max-history') ?? '8', 10)
    this._config = {
      mode,
      endpoint,
      endpointValid: validEndpoint(endpoint),
      position,
      theme,
      title: this.getAttribute('title') || defaults.title,
      kicker: this.getAttribute('kicker') || defaults.kicker,
      subtitle: this.getAttribute('subtitle') || defaults.subtitle,
      launcherLabel: this.getAttribute('launcher-label') || 'Ask LeakScout',
      maxHistory: Number.isFinite(parsedHistory) ? Math.max(0, Math.min(MAX_HISTORY_MESSAGES, parsedHistory)) : MAX_HISTORY_MESSAGES,
      suggestions: parseSuggestions(this._suggestionsProperty ?? this.getAttribute('suggestions'), defaults.suggestions),
      credentials: ['omit', 'same-origin', 'include'].includes(this.getAttribute('credentials'))
        ? this.getAttribute('credentials')
        : mode === 'merchant' ? 'include' : 'same-origin',
      showCtas: mode === 'public' || this.getAttribute('show-ctas') === 'true',
    }
    this._title.textContent = this._config.title
    this._kicker.textContent = this._config.kicker
    this._subtitle.textContent = this._config.subtitle
    this._greetingText.textContent = mode === 'public'
      ? 'I can explain what LeakScout investigates, how audits work, how Orbio is used, and whether the demo or your own data is the best place to start.'
      : 'I can help you interpret verified business signals and decide what to check next.'
    this._launcher.setAttribute('aria-label', this._config.launcherLabel)
    this._launcher.querySelector('.tooltip').textContent = this._config.launcherLabel
    this._close.setAttribute('aria-label', `Close ${this._config.title}`)
    this._textarea.maxLength = mode === 'public' ? MAX_PUBLIC_QUESTION : MAX_MERCHANT_QUESTION
    this._textarea.placeholder = mode === 'public' ? 'Ask how LeakScout works…' : 'Ask about your business signals…'
    this._panel.dataset.mode = mode
    this.dataset.position = position
    this.dataset.theme = theme
    const accent = this.getAttribute('accent')
    if (accent && globalThis.CSS?.supports?.('color', accent)) {
      this.style.setProperty('--leakscout-accent', accent)
    }
    this._renderSuggestions()
    this._renderCtas()
  }

  _renderSuggestions() {
    this._suggestionRegion.replaceChildren()
    if (this._hasConversation) return
    for (const prompt of this._config.suggestions) {
      const button = node('button', 'suggestion', prompt)
      button.type = 'button'
      button.addEventListener('click', () => {
        this._textarea.value = prompt
        this._resizeTextarea()
        this._textarea.focus()
      })
      this._suggestionRegion.append(button)
    }
  }

  _renderCtas() {
    this._ctaRegion.replaceChildren()
    if (!this._config.showCtas || this._hasConversation) return
    const demo = node('button', 'cta', 'Try demo business')
    demo.type = 'button'
    demo.addEventListener('click', () => {
      this._emit('leakscout:demo')
      this.close()
    })
    const audit = node('button', 'cta secondary', 'Run profit audit')
    audit.type = 'button'
    audit.addEventListener('click', () => {
      this._emit('leakscout:audit')
      this.close()
    })
    this._ctaRegion.append(demo, audit)
  }

  _emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, {
      bubbles: true,
      composed: true,
      detail: { mode: this._config.mode, ...detail },
    }))
  }

  open() {
    if (this._isOpen) return
    this._isOpen = true
    this._panel.hidden = false
    this._launcher.hidden = true
    this._launcher.setAttribute('aria-expanded', 'true')
    this._syncViewport()
    if (this._mobileQuery?.matches) this._lockPageScroll()
    this._textarea.focus()
    this._emit('leakscout:open')
  }

  close() {
    if (!this._isOpen) return
    this._isOpen = false
    this._panel.hidden = true
    this._launcher.hidden = false
    this._launcher.setAttribute('aria-expanded', 'false')
    this._unlockPageScroll()
    this._launcher.focus()
    this._emit('leakscout:close')
  }

  _lockPageScroll() {
    if (!document.body || this._bodyLocked) return
    this._previousBodyOverflow = document.body.style.overflow
    this._previousRootOverflow = document.documentElement?.style.overflow ?? ''
    document.body.style.overflow = 'hidden'
    if (document.documentElement) document.documentElement.style.overflow = 'hidden'
    this._bodyLocked = true
  }

  _unlockPageScroll() {
    if (!this._bodyLocked || !document.body) return
    document.body.style.overflow = this._previousBodyOverflow
    if (document.documentElement) document.documentElement.style.overflow = this._previousRootOverflow
    this._bodyLocked = false
  }

  _syncViewport() {
    if (!this.style) return
    const height = globalThis.visualViewport?.height
    if (height && Number.isFinite(height)) this.style.setProperty('--leakscout-viewport-height', `${height}px`)
    const offsetTop = globalThis.visualViewport?.offsetTop
    if (offsetTop !== undefined && Number.isFinite(offsetTop)) {
      this.style.setProperty('--leakscout-viewport-offset', `${offsetTop}px`)
    }
    if (this._isOpen && this._mobileQuery?.matches) this._lockPageScroll()
    else this._unlockPageScroll()
    this._panel?.setAttribute('aria-modal', String(Boolean(this._isOpen && this._mobileQuery?.matches)))
  }

  _resizeTextarea() {
    this._textarea.style.height = 'auto'
    this._textarea.style.height = `${Math.min(this._textarea.scrollHeight, 104)}px`
  }

  _appendMessage(role, content) {
    const message = node('div', `message ${role === 'user' ? 'user-message' : 'assistant-message'}`)
    if (role === 'assistant') message.append(node('strong', '', 'LeakScout'))
    message.append(node('p', '', content))
    this._conversation.append(message)
    if (role === 'user') this._hasConversation = true
    this._conversation.scrollTop = this._conversation.scrollHeight
    this._renderSuggestions()
    this._renderCtas()
    return message
  }

  _startSubmission(value) {
    if (this._busy) return
    const question = String(value ?? '').trim().slice(0, this._config.mode === 'public' ? MAX_PUBLIC_QUESTION : MAX_MERCHANT_QUESTION)
    if (!question) return
    this._pending = { question, history: [...this._messages] }
    this._appendMessage('user', question)
    this._textarea.value = ''
    this._resizeTextarea()
    this._emit('leakscout:submit', { questionLength: question.length })
    this._submitPending()
  }

  async _submitPending() {
    if (!this._pending || this._busy) return
    this._busy = true
    this._send.disabled = true
    this._retry.hidden = true
    this._conversation.setAttribute('aria-busy', 'true')
    const loading = this._appendMessage('assistant', 'LeakScout is thinking…')
    loading.classList.add('loading-message')
    const pending = this._pending
    const generation = ++this._requestGeneration
    this._requestController = new AbortController()
    try {
      if (!this._config.endpointValid || this._config.mode === 'merchant' && !this._config.endpoint) {
        throw new Error(SAFE_ERROR)
      }
      const body = buildRequestPayload(
        this._config.mode,
        pending.question,
        pending.history,
        this._config.maxHistory,
      )
      const response = await fetch(this._config.endpoint, {
        method: 'POST',
        credentials: this._config.credentials,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this._requestController.signal,
      })
      const payload = await response.json().catch(() => null)
      if (generation !== this._requestGeneration) return
      if (!response.ok) throw new Error(SAFE_ERROR)
      const normalized = normalizeResponse(this._config.mode, payload)
      loading.remove()
      this._appendMessage('assistant', normalized.answer)
      this._messages.push(
        { role: 'user', content: pending.question },
        { role: 'assistant', content: normalized.answer },
      )
      this._messages = this._config.maxHistory === 0
        ? []
        : this._messages.slice(-this._config.maxHistory)
      this._pending = null
      this._powered.hidden = !normalized.poweredBy
      this._emit('leakscout:response', {
        answerLength: normalized.answer.length,
        inferenceUsed: normalized.inferenceUsed,
        poweredBy: normalized.poweredBy ? 'Orbio' : null,
      })
    } catch {
      if (generation !== this._requestGeneration) return
      loading.remove()
      this._appendMessage('assistant', SAFE_ERROR)
      this._powered.hidden = true
      this._retry.hidden = false
      this._emit('leakscout:error', { retryable: true })
    } finally {
      if (generation === this._requestGeneration) {
        this._busy = false
        this._send.disabled = false
        this._conversation.removeAttribute('aria-busy')
        this._requestController = null
        if (this._isOpen) this._textarea.focus()
      }
    }
  }
}

if (globalThis.customElements && !customElements.get('leakscout-assistant')) {
  customElements.define('leakscout-assistant', LeakScoutAssistant)
}
