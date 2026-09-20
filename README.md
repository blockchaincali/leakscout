<p align="center">
  <img src="assets/orb.png" alt="" width="72" />
</p>

<h1 align="center">Orbio starter</h1>

<p align="center">
  An example of building on an Orbio key.<br />
  Not required reading. Not a required stack. Build something magical.
</p>

---

## LeakScout

LeakScout is a standalone business-intelligence engine and API for finding verified operational and financial signals in sales and inventory data. Shopswift is its first integration target; Shopswift-specific behavior is handled by flexible input parsing, not embedded in the analytics engine.

```bash
pnpm leakscout:web   # http://localhost:3000
pnpm test            # deterministic and API tests
pnpm typecheck
```

API endpoints:

- `GET /api/health` — service capabilities and currency semantics.
- `POST /api/audit` — multipart CSV audit with optional `sales`, optional `inventory`, and `sourceCurrency` (at least one file is required).
- `POST /api/demo` — bundled demo business, denominated in NGN.

`sourceCurrency` describes the currency already used in the uploaded data. LeakScout does not perform FX conversion or relabel the bundled demo. The execution boundary is `executeLeakScout(...)`: it selects a sales-only, inventory-only, or full deterministic audit and invokes Orbio only when a full audit has enough verified candidates to prioritize.

```text
CSV / future adapter -> deterministic analytics -> verified candidate IDs
                    -> conditional Orbio prioritization -> report + actions
```

All uploaded files are processed in memory. Financial calculations remain deterministic; the agent cannot create candidates or change calculated financial values.

---

Your Orbio key is an [OpenRouter](https://openrouter.ai) key, funded by the credits your `$ORBIO` earns. One key, every model, and everything else OpenRouter does — image and video generation, web search, PDFs, voice, sandboxed shells, subagents. This repo shows the shapes, in TypeScript, with nothing hidden.

Use it as a reference, copy one file out of it, or ignore it and write Python. The competition has no rules about how; only that the key is yours.

## Get a key

1. Hold `$ORBIO` and connect the wallet at [orbio.so](https://orbio.so).
2. Claim a key — on the dashboard, or from your agent through the [Orbio MCP](https://orbio.so/mcp) (`orbio_claim_key`).
3. Put it in `.env.local`:

```bash
cp .env.example .env.local
# OPENROUTER_API_KEY=sk-or-v1-…
```

That's the whole setup.

## Run the examples

```bash
pnpm install

pnpm chat        # 01  streamed chat — the smallest useful call
pnpm tools       # 02  tool calling, the agent loop with nothing hidden
pnpm structured  # 03  structured outputs — typed JSON, validated end to end
pnpm search      # 04  web search, run by OpenRouter (server tools)
pnpm image       # 05  image generation on /api/v1/images
pnpm pdf         # 06  read a PDF — a file is just another content part
pnpm agent       # 07  all of it composed: research → shape → deliver
```

Each one is a single file under [`src/examples`](src/examples), 30–80 lines, readable top to bottom. [`src/lib/openrouter.ts`](src/lib/openrouter.ts) is the only shared code: the client, a raw `fetch` for endpoints the SDK doesn't model, and a default model you can change with `OPENROUTER_MODEL`.

## What the key can do

| | docs |
|---|---|
| Every model — Claude, GPT, Gemini, open weights, `openrouter/auto` | [models](https://openrouter.ai/models) |
| Image generation, video, text-to-speech | [image](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) · [video](https://openrouter.ai/docs/guides/overview/multimodal/video-generation) · [tts](https://openrouter.ai/docs/guides/overview/multimodal/tts) |
| Image, PDF, audio and video inputs | [multimodal](https://openrouter.ai/docs/guides/overview/multimodal/overview) |
| Server tools: web search, web fetch, image gen, subagents, advisor, shell | [server tools](https://openrouter.ai/docs/guides/features/server-tools) · [containers](https://openrouter.ai/docs/guides/features/containers) |
| Structured outputs, response healing | [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs) |
| Tool calling with the Agent SDK | [agent sdk](https://openrouter.ai/docs/agent-sdk/call-model/tools) |
| Run Claude Code or Codex on the key | [claude code](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration) · [codex](https://openrouter.ai/docs/cookbook/coding-agents/codex-cli) |
| Model fallbacks, `:nitro` / `:floor` / `:free` | [routing](https://openrouter.ai/docs/guides/routing/model-fallbacks) |

Prefer using the key **from code** — the OpenAI SDK, the Vercel AI SDK, the OpenRouter Agent SDK — so what you build is an agent, not a chat window. Claude Code and Codex on the key are fine too.

## Ideas

[`IDEAS.md`](IDEAS.md) has a list of directions people are circling. None of them is an assignment.

## Build Week

Seven days, ten winners, 8M `$ORBIO`. Every approved builder gets $100 of inference to start and a 20% boost on the credits their holdings earn.

- Apply → [orbio.so/build](https://orbio.so/build)
- The brief → [orbio.so/orbio-build-week.pdf](https://orbio.so/orbio-build-week.pdf)

Orbio ships new features daily during the week. All of it is yours to use.

## Licence

MIT. Take anything.
