# RAETH — The trading terminal for autonomous market agents

RAETH is an **agentic exchange demo**: a glass-box trading venue where every order, fill,
and settlement runs through a real matching engine, and where AI agents trade the *same*
book that humans inspect in the terminal. It pairs a deterministic **Rust CLOB matching
engine compiled to WebAssembly** with a TanStack Start + React 19 front end, a server-side
event-sourced exchange ledger, and a Groq-powered support assistant that reads live state
through read-only MCP-style tools.

> **Status: demo / portfolio project.** No real money is involved. Market data is
> simulated, accounts are seeded with a $10,000 testnet bankroll, and the public exchange
> API (`raeth.exchange` REST/WebSocket/MCP) shown on the Docs page is **illustrative
> narrative copy** — it is not a live, deployed public endpoint. The matching, the agent
> arena, the support bot, and the NL strategy builder, however, all really run.

---

## What's actually running

RAETH has **two independent exchange engines** that deliberately do not share state:

| | Client engine | Server engine |
| --- | --- | --- |
| **Where** | Browser Web Worker (`src/workers/matching.worker.ts`) | Server / Nitro runtime (`src/lib/exchange/`) |
| **Core** | Rust CLOB → WASM (`src/wasm/`), `WasmSimulator` | Event-sourced `ExchangeStore` + `ts-simulator.ts` |
| **Lifetime** | Ephemeral, per page load | Lives for the server process; replayable from its event log |
| **Powers** | Trade terminal + Strategy Arena (live, interactive) | Read-only MCP tools consumed by the Groq support bot |

The Rust matching core is a separate, fully documented crate (see
[`src/wasm/README.md`](src/wasm/README.md)): strict price-time priority, integer ticks (no
floating point), deterministic replay, O(1) cancel, and ~14M orders/sec on a laptop. Here it
is compiled to WASM and driven from the browser so the book you watch is the book your agents
trade.

---

## The five glass-box agent features

The whole point of RAETH is making an autonomous trader **inspectable**. Everything below is
client-side and simulated, built on the shared agent core in [`src/lib/agents/`](src/lib/agents/).

1. **Glass-Box ThoughtStream** *(`/trade`)* — every agent decision is rendered with its risk
   check and its expected-vs-actual PnL, so you can see *why* it traded, not just that it did.
2. **Time-Travel replay** *(`/trade`)* — play / step / speed controls over the event log plus
   an event ticker; scrub a market window forward and back deterministically.
3. **Strategy Arena** *(`/arena`)* — a leaderboard of bots running the five built-in
   strategies head-to-head, each with its own risk firewall.
4. **Natural-language strategy builder** — describe a strategy in plain English; a Groq
   `llama-3.3-70b` server function (`src/lib/nl-strategy.ts`) parses it into a Zod-validated
   config (`src/lib/agents/strategy-schema.ts`) and arms a bot in the arena.
5. **Risk Firewall** *(`/trade`, `/arena`)* — pre-trade risk evaluation and behavioral alerts
   (`src/lib/agents/risk.ts`) that gate and explain every order.

---

## Tech stack

- **Framework:** [TanStack Start](https://tanstack.com/start) (file-based routing, server functions, SSR)
- **UI:** React 19, Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com) (Radix primitives), Recharts, Lucide
- **Matching core:** Rust CLOB compiled to WebAssembly, run in a Web Worker
- **AI:** [Groq](https://groq.com) (`llama-3.3-70b-versatile`) for the support bot + NL strategy parsing
- **Retrieval:** in-repo BM25 RAG over a small docs corpus (`src/lib/rag/`)
- **Validation:** Zod
- **Deploy target:** Cloudflare / Nitro (via `@lovable.dev/vite-tanstack-config`)
- **Tooling:** Vite 8, Vitest, ESLint (flat config) + Prettier, TypeScript

---

## Getting started

### Prerequisites

- Node.js 20+
- A free [Groq API key](https://console.groq.com) (only needed for the support bot and the
  NL strategy builder)

### Install & run

```bash
npm install
cp .env.example .env.local   # then add your GROQ_API_KEY
npm run dev                   # http://localhost:8080
```

The terminal, charts, order book, and Strategy Arena work without any API key — they run
entirely on the in-browser WASM engine. Only the AI features (support chat, NL strategy
builder) require `GROQ_API_KEY`.

### Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GROQ_API_KEY` | for AI features | — | Groq key used by the support bot and NL strategy parser |
| `GROQ_MODEL` | no | `llama-3.3-70b-versatile` | Override the Groq model |

See [`.env.example`](.env.example) for details.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server on port 8080 |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Prettier enforced via the config) |
| `npm run format` | Prettier write |
| `npm run test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |

> Use **npm** — a `package-lock.json` is committed. (A stale `bun.lock` also exists; ignore it.)

---

## Routes

| Path | What it is |
| --- | --- |
| `/` | Landing page + interactive sample-agent runner |
| `/trade` | The trading terminal: book, chart, fills, order entry, Glass-Box ThoughtStream, Time-Travel, Risk Firewall |
| `/arena` | Strategy Arena — bots competing on a leaderboard, NL strategy builder |
| `/markets` | Market list (BTC perpetual, BTC Up/Down binaries, parlays) |
| `/agents` | Account / sub-wallet setup and the MCP tool catalog |
| `/analytics` | Per-agent analytics |
| `/docs` | Developer docs (REST / WebSocket / MCP quickstart — illustrative) |
| `/support` | Groq-powered support assistant (RAG + read-only MCP tools) |

---

## Project structure

```
raeth/
├── src/
│   ├── routes/              # file-based routes (see src/routes/README.md)
│   ├── components/          # app components + ui/ (shadcn primitives)
│   ├── lib/
│   │   ├── agents/          # shared agent core: strategies, indicators, risk, metrics, accounting, runner
│   │   ├── exchange/        # server-side event-sourced ExchangeStore + simulator
│   │   ├── mcp/             # read-only MCP-style tool definitions for the support bot
│   │   ├── rag/             # BM25 retriever + docs corpus
│   │   ├── nl-strategy.ts   # NL → strategy config (Groq server function)
│   │   └── support-chat.ts  # support bot pipeline (RAG → Groq → tools)
│   ├── workers/             # matching.worker.ts (client WASM engine)
│   ├── wasm/                # Rust CLOB compiled to WASM (+ its own README)
│   ├── server.ts / start.ts # SSR entry + error-handling middleware
│   └── styles.css
├── .env.example
├── vite.config.ts           # thin wrapper over @lovable.dev/vite-tanstack-config
└── package.json
```

---

## Notes & caveats

- **`src/routeTree.gen.ts` is auto-generated** by the TanStack router plugin — don't edit it
  by hand.
- The agent platform is **simulated and client-side**: bots, fills, and PnL are computed in
  the browser against the WASM book. There is no real custody, settlement, or counterparty.
- This project is connected to [Lovable](https://lovable.dev). Avoid force-pushing or
  rewriting published git history, since the connected branch syncs back to the editor (see
  [`AGENTS.md`](AGENTS.md)).
- If you cloned `.env.example` from an earlier revision, **rotate any committed Groq key** —
  treat keys in version control as compromised.

---

## License

No license file is present; treat this as "all rights reserved" unless the author states
otherwise.
