import express from 'express'
import helmet from 'helmet'
import multer from 'multer'
import { rateLimit } from 'express-rate-limit'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  loadInventoryCsv,
  loadSalesCsv,
  parseInventoryCsvText,
  parseSalesCsvText,
} from '../analytics/parser.js'
import {
  executeLeakScout,
  type LeakScoutExecution,
} from './service.js'
import { AssistantInferenceError, InputError } from '../errors.js'
import { parseShopswiftAuditPayload } from '../integrations/shopswift.js'
import type { InventoryRow, SalesRow } from '../types.js'
import { convertDemoDataset, type DemoCurrency } from './demoCurrency.js'
import {
  answerPublicLeakScoutQuestion,
  answerLeakScoutQuestion,
  generateAiBrief,
  parseBriefRequest,
  parseChatRequest,
  parsePublicAssistantRequest,
  type AssistantMetadata,
  type AiBrief,
  type BriefRequest,
  type ChatRequest,
  type LeakScoutAssistantResponse,
  type PublicAssistantRequest,
  type PublicAssistantResponse,
} from '../agent/assistant.js'

type LeakScoutExecutor = (
  sales: SalesRow[],
  inventory: InventoryRow[],
  currency: string,
) => Promise<LeakScoutExecution>

type LeakScoutAppOptions = {
  root?: string
  production?: boolean
  integrationSecret?: string
  execute?: LeakScoutExecutor
  generateBrief?: (
    request: BriefRequest,
  ) => Promise<AiBrief & AssistantMetadata>
  answerChat?: (
    request: ChatRequest,
  ) => Promise<LeakScoutAssistantResponse & AssistantMetadata>
  answerPublic?: (
    request: PublicAssistantRequest,
  ) => Promise<PublicAssistantResponse>
}

export const DEMO_CURRENCIES = [
  'USD',
  'NGN',
  'GBP',
  'EUR',
  'GHS',
  'KES',
  'ZAR',
  'CAD',
  'AUD',
  'INR',
  'JPY',
  'AED',
  'SAR',
  'CHF',
  'SGD',
  'NZD',
] as const

type SupportedDemoCurrency = (typeof DEMO_CURRENCIES)[number]

const demoRequestSchema = z
  .object({
    currency: z.enum(DEMO_CURRENCIES).optional(),
  })
  .strict()

function parseDemoRequest(input: unknown): SupportedDemoCurrency {
  const parsed = demoRequestSchema.safeParse(input ?? {})

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new InputError(
      `Invalid demo request. ${issue?.message ?? 'Validation failed.'}`,
    )
  }

  return parsed.data.currency ?? 'USD'
}

function secretsMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash('sha256').update(provided).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(providedDigest, expectedDigest)
}

export function createLeakScoutApp(
  options: LeakScoutAppOptions = {},
) {
  const app = express()
  const root = options.root ?? process.cwd()
  const integrationSecret =
    options.integrationSecret ?? process.env.LEAKSCOUT_INTEGRATION_SECRET
  const execute = options.execute ?? executeLeakScout
  const generateBrief = options.generateBrief ?? generateAiBrief
  const answerChat = options.answerChat ?? answerLeakScoutQuestion
  const answerPublic =
    options.answerPublic ?? answerPublicLeakScoutQuestion

app.disable('x-powered-by')

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'same-origin',
    },
  }),
)

const isProduction =
  options.production ?? process.env.NODE_ENV === 'production'

/*
 * Development: no practical rate limit.
 *
 * Production:
 * - uploaded audits: generous because partial audits spend no inference
 * - demo endpoint: tighter because it always runs the full Orbio flow
 */
const auditLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isProduction,
  message: {
    error:
      'Audit limit reached. Please wait a few minutes before running another investigation.',
  },
})

const demoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isProduction,
  message: {
    error:
      'Demo limit reached. Please wait a few minutes before running another Orbio investigation.',
  },
})

const integrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isProduction,
  message: {
    error: 'Integration request limit reached. Please retry later.',
  },
})

const publicAssistantLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isProduction,
  message: {
    error:
      'Assistant limit reached. Please wait a few minutes before asking another question.',
  },
})

const integrationAuth: express.RequestHandler = (req, res, next) => {
  const authorization = req.get('authorization')
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  const provided = match?.[1] ?? ''
  const authenticated =
    Boolean(integrationSecret) &&
    Boolean(provided) &&
    secretsMatch(provided, integrationSecret ?? '')

  if (!authenticated) {
    res.set('WWW-Authenticate', 'Bearer')
    res.status(401).json({ error: 'Unauthorized.' })
    return
  }

  next()
}

const assistantJson = express.json({
  limit: '256kb',
  type: 'application/json',
})

const publicAssistantJson = express.json({
  limit: '4kb',
  type: 'application/json',
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 2,
    fields: 4,
    fieldSize: 10_000,
  },
  fileFilter: (
    _req,
    file,
    callback,
  ) => {
    const isCsv =
      file.originalname
        .toLowerCase()
        .endsWith('.csv')

    if (!isCsv) {
      callback(
        new InputError(
          'Only .csv files are accepted.',
        ),
      )
      return
    }

    callback(null, true)
  },
})

app.get(
  '/api/health',
  (_req, res) => {
    res.json({
      ok: true,
      service: 'LeakScout',
      version: '0.2.0',
      architecture:
        'deterministic-analysis + conditional-Orbio-agent',
      modes: [
        'full',
        'sales_only',
        'inventory_only',
      ],
      currencySemantics: 'source_accounting_currency',
    })
  },
)

app.post(
  '/api/public/assistant',
  publicAssistantLimiter,
  publicAssistantJson,
  async (req, res) => {
    const request = parsePublicAssistantRequest(req.body)

    try {
      const answer = await answerPublic(request)
      res.json(answer)
    } catch {
      res.status(503).json({
        error: 'The LeakScout assistant is temporarily unavailable.',
      })
    }
  },
)

app.post(
  '/api/demo',
  demoLimiter,
  express.json({
    limit: '4kb',
    type: 'application/json',
  }),
  async (req, res) => {
    const currency = parseDemoRequest(req.body)

    const sales =
      await loadSalesCsv(
        join(
          root,
          'demo',
          'sales.csv',
        ),
      )

    const inventory =
      await loadInventoryCsv(
        join(
          root,
          'demo',
          'inventory.csv',
        ),
      )

    const converted = convertDemoDataset(
      sales,
      inventory,
      currency as DemoCurrency,
    )

    const result =
      await execute(
        converted.sales,
        converted.inventory,
        currency,
      )

    res.json(result)
  },
)

app.post(
  '/api/integrations/shopswift/audit',
  integrationLimiter,
  integrationAuth,
  express.json({
    limit: '1mb',
    type: 'application/json',
  }),
  async (req, res) => {
    const { sales, inventory, currency } = parseShopswiftAuditPayload(req.body)
    const result = await execute(sales, inventory, currency)
    res.json(result)
  },
)

app.post(
  '/api/integrations/shopswift/brief',
  integrationLimiter,
  integrationAuth,
  assistantJson,
  async (req, res) => {
    const request = parseBriefRequest(req.body)
    const brief = await generateBrief(request)
    res.json(brief)
  },
)

app.post(
  '/api/integrations/shopswift/chat',
  integrationLimiter,
  integrationAuth,
  assistantJson,
  async (req, res) => {
    const request = parseChatRequest(req.body)
    const answer = await answerChat(request)
    res.json(answer)
  },
)

app.post(
  '/api/audit',
  auditLimiter,
  upload.fields([
    {
      name: 'sales',
      maxCount: 1,
    },
    {
      name: 'inventory',
      maxCount: 1,
    },
  ]),
  async (req, res) => {
    const files = req.files as
      | Record<
          string,
          Express.Multer.File[]
        >
      | undefined

    const salesFile =
      files?.sales?.[0]

    const inventoryFile =
      files?.inventory?.[0]

    if (
      !salesFile &&
      !inventoryFile
    ) {
      res.status(400).json({
        error:
          'Add at least one CSV: sales or inventory.',
      })
      return
    }

    const currency =
      typeof req.body?.sourceCurrency === 'string'
        ? req.body.sourceCurrency
        : typeof req.body?.currency === 'string'
          ? req.body.currency
          : 'NGN'

    const sales = salesFile
      ? parseSalesCsvText(
          salesFile.buffer.toString(
            'utf8',
          ),
        )
      : []

    const inventory =
      inventoryFile
        ? parseInventoryCsvText(
            inventoryFile.buffer.toString(
              'utf8',
            ),
          )
        : []

    const result =
      await execute(
        sales,
        inventory,
        currency,
      )

    res.json(result)
  },
)

app.use(
  express.static(
    join(root, 'public'),
    {
      extensions: ['html'],
      maxAge:
        process.env.NODE_ENV ===
        'production'
          ? '1h'
          : 0,
    },
  ),
)

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    void _next

    if (
      error instanceof
      multer.MulterError
    ) {
      res.status(400).json({
        error:
          error.code ===
          'LIMIT_FILE_SIZE'
            ? 'CSV files must be 5 MB or smaller.'
            : error.message,
      })
      return
    }

    const isBadJson =
      error instanceof SyntaxError &&
      'status' in error &&
      error.status === 400

    const isBodyTooLarge =
      error instanceof Error &&
      'type' in error &&
      error.type === 'entity.too.large'

    if (isBodyTooLarge) {
      res.status(413).json({ error: 'JSON request body is too large.' })
      return
    }

    if (error instanceof InputError || isBadJson) {
      res.status(400).json({
        error: error instanceof InputError
          ? error.message
          : 'Request body contains malformed JSON.',
      })
      return
    }

    if (error instanceof AssistantInferenceError) {
      res.status(error.statusCode).json({ error: error.message })
      return
    }

    console.error('LeakScout request failed with an internal error.')
    res.status(500).json({
      error: 'LeakScout could not complete this request.',
    })
  },
)

  return app
}

export function startLeakScoutServer() {
  const port = Number(process.env.PORT ?? 3000)
  const app = createLeakScoutApp()

  return app.listen(port, () => {
    console.log(`LeakScout running at http://localhost:${port}`)
  })
}

const entryPoint = process.argv[1]

if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  startLeakScoutServer()
}
