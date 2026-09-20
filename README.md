# LeakScout

LeakScout is an autonomous business investigation agent that identifies verified profit and operational leaks in merchant data. It combines deterministic financial analysis with conditional agent reasoning so businesses receive evidence-backed findings and prioritized actions, not invented numbers.

**Live demo:** https://leakscout-production-deaf.up.railway.app

**First integration target: Shopswift**

## Architecture

```text
Business data
    -> deterministic analytics
    -> verified candidate signals
    -> decision whether inference is worthwhile
    -> Orbio investigation
    -> prioritized actions
```

- **LeakScout** is the standalone intelligence engine and API.
- **Shopswift** is the first integration and deployment target. This repository does not claim that integration is already live.
- **Orbio** is the autonomous inference and investigation layer used when verified candidates provide enough context to justify it.

The core engineering principle is simple: **financial calculations are deterministic.** LeakScout's agent chooses what deserves attention, but it cannot create a candidate, invent a financial figure, or modify a value calculated by the analytics engine. If inference is unnecessary, lacks sufficient context, or fails, LeakScout returns an appropriate deterministic result.

## Audit modes

- **Inventory-only:** evaluates catalogue health, field coverage, identifier quality, pricing visibility, inventory exposure where supported, and readiness for deeper investigation. It does not invoke Orbio.
- **Sales-only:** evaluates supported sales, margin, and anomaly signals without pretending inventory context exists. It does not invoke Orbio.
- **Full profit audit:** joins sales and inventory context, runs the full deterministic detector set, and conditionally invokes Orbio when there are enough verified candidates to prioritize.

## CSV ingestion

LeakScout accepts a sales CSV, an inventory CSV, or both. Files are parsed in memory and are not stored by the application.

Ingestion is designed for real merchant exports: headers are case- and punctuation-insensitive, and common aliases are accepted. For example, `sku`, `product_sku`, and `item_sku` can identify a product; `unit_price`, `selling_price`, and `retail_price` can identify selling price. Sales dates must use `YYYY-MM-DD` or an ISO timestamp. A product name, SKU, or barcode can identify inventory rows.

Typical fields:

| Dataset | Common fields |
| --- | --- |
| Sales | `date`, `sku`, `product_name`, `quantity`, `unit_price`, `unit_cost` |
| Inventory | `sku`, `product_name`, `current_stock`, `unit_cost`, `selling_price`, `lead_time_days`, `category`, `available` |

Unknown data remains unknown. For example, missing costs do not become selling prices, and inventory systems that use `-1` for untracked stock are not treated as having negative or zero inventory.

### Source-currency semantics

`sourceCurrency` declares the accounting currency already present in the uploaded files. LeakScout does not perform foreign-exchange conversion and does not relabel financial values. The bundled demo data is denominated in NGN.

## API

### `GET /api/health`

Returns service status, supported data modes, architecture, and currency semantics.

### `POST /api/audit`

Runs an uploaded audit. Send `multipart/form-data` with:

- `sales`: optional sales CSV
- `inventory`: optional inventory CSV
- `sourceCurrency`: optional ISO currency code; defaults to `NGN`

At least one CSV is required. Providing both activates full-audit eligibility; Orbio is still invoked only when the deterministic result contains enough verified candidates.

### `POST /api/integrations/shopswift/audit`

Accepts normalized JSON from trusted server-to-server consumers such as Shopswift. This is an integration contract; it does not mean the Shopswift production integration is complete.

Authenticate with the server-side integration secret:

```http
Authorization: Bearer <LEAKSCOUT_INTEGRATION_SECRET>
Content-Type: application/json
```

Example request:

```json
{
  "currency": "NGN",
  "sales": [
    {
      "date": "2026-03-01T10:30:00Z",
      "sku": "COF-1",
      "productName": "Coffee",
      "quantity": 2,
      "sellingPrice": 1000,
      "unitCost": 700
    }
  ],
  "inventory": [
    {
      "sku": "COF-1",
      "productName": "Coffee",
      "currentStock": 10,
      "unitCost": 700,
      "sellingPrice": 1000,
      "supplierLeadTimeDays": 5,
      "category": "Drinks",
      "available": true
    }
  ]
}
```

At least one non-empty dataset is required. Sales are limited to 10,000 rows, inventory to 5,000 rows, and the JSON body to 1 MB. Missing optional financial or stock values remain unknown. `currentStock: -1` means untracked stock; other negative stock values are rejected. Successful responses use the standard LeakScout execution shape: `dataMode`, `agentUsed`, `agentStatus`, `poweredBy`, `coverage`, `audit`, `report`, and `currencySemantics`.

### `POST /api/demo`

Runs the bundled full-audit demo using the NGN-denominated sample sales and inventory data.

Successful audit responses include the deterministic audit, report, data mode, agent status, coverage limitations, provider attribution, and source-currency semantics.

## Local development

Requires Node.js 22+ and pnpm 10.

```bash
pnpm install
cp .env.example .env.local
pnpm leakscout:web
```

Open http://localhost:3000. `pnpm start` runs the same LeakScout web server and is suitable for a production process command.

## Environment variables

```dotenv
# Required for full audits that qualify for Orbio investigation.
OPENROUTER_API_KEY=your_orbio_issued_openrouter_key

# Optional model override.
OPENROUTER_MODEL=google/gemini-2.5-flash-lite

# Optional OpenRouter application attribution.
APP_NAME=LeakScout
APP_URL=http://localhost:3000

# Required for trusted server-to-server integrations.
LEAKSCOUT_INTEGRATION_SECRET=replace-with-a-long-random-secret
```

- `OPENROUTER_API_KEY`: the Orbio-issued inference key used through OpenRouter. Never commit a real key.
- `OPENROUTER_MODEL`: model used by the investigation layer. If omitted, the code's configured default is used.
- `APP_NAME`: application name sent for OpenRouter attribution.
- `APP_URL`: application URL sent for OpenRouter attribution.
- `LEAKSCOUT_INTEGRATION_SECRET`: shared secret required by integration routes. Keep it server-side and send it only in the `Authorization` bearer header.

## Automated tests

```bash
pnpm test
pnpm typecheck
pnpm lint
node --check public/app.js
```

The suite covers deterministic analytics, CSV and integration-JSON validation safeguards, authentication, agent-output validation, partial-data behavior, provider fallback, and API behavior. Provider calls are stubbed in HTTP tests, so the automated suite does not spend Orbio credits.

## Deployment

LeakScout is a stateless Node.js service. Deploy the repository with:

```bash
pnpm install --frozen-lockfile
pnpm start
```

The server reads the platform-provided `PORT` environment variable and serves both the UI and API. Configure the environment variables above in the deployment platform; keep `OPENROUTER_API_KEY` and `LEAKSCOUT_INTEGRATION_SECRET` secret. The production deployment currently runs on Railway at https://leakscout-production-deaf.up.railway.app.

## Attribution

LeakScout was built for **Orbio Build Week** and uses an **Orbio-issued inference key** for conditional investigation through OpenRouter.

## License

MIT
