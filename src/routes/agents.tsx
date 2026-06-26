import { createFileRoute } from "@tanstack/react-router";
import { AgentRunner } from "../components/agent-runner";
import { PageShell } from "../components/site-chrome";
import { getRequestOrigin } from "../lib/origin.functions";
import ogAgents from "../assets/og/agents.jpg";

export const Route = createFileRoute("/agents")({
  loader: async () => ({ origin: await getRequestOrigin() }),
  head: ({ loaderData }) => {
    const ogImage = `${loaderData?.origin ?? ""}${ogAgents}`;
    return {
      meta: [
        { title: "Agents — RAETH Agentic Exchange" },
        {
          name: "description",
          content:
            "Connect Claude or any MCP client, scope an API key, and run autonomous trading agents on live RAETH testnet markets.",
        },
        { property: "og:title", content: "Agents — RAETH" },
        {
          property: "og:description",
          content:
            "Run autonomous trading agents on live BTC markets over REST, WebSocket, and MCP.",
        },
        { property: "og:type", content: "website" },
        { property: "og:url", content: "/agents" },
        { property: "og:image", content: ogImage },
        { name: "twitter:image", content: ogImage },
      ],
      links: [{ rel: "canonical", href: "/agents" }],
    };
  },
  component: AgentsPage,
});

const TEMPLATES = [
  {
    tag: "MOMENTUM",
    name: "5m Momentum",
    desc: "Trades BTC Up/Down from short-window momentum and volatility bias.",
    market: "BTC-UPDOWN",
  },
  {
    tag: "MARKET-MAKE",
    name: "Perp Maker",
    desc: "Quotes both sides of the BTC perp, manages inventory against funding.",
    market: "BTC-PERP",
  },
  {
    tag: "ARB",
    name: "Binary/Perp Arb",
    desc: "Hedges binary exposure with the perpetual to harvest pricing gaps.",
    market: "MULTI",
  },
];

const TOOLS = [
  { name: "get_markets", desc: "List open markets, windows, and current marks." },
  { name: "get_orderbook", desc: "Stream depth for a market symbol." },
  { name: "place_order", desc: "Submit a scoped limit or market order." },
  { name: "get_positions", desc: "Read positions, margin, and realized PnL." },
  { name: "cancel_order", desc: "Cancel a resting order by id." },
  { name: "stream_fills", desc: "Subscribe to fills and settlement events." },
];

function AgentsPage() {
  return (
    <PageShell>
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
          RAETH / Agents
        </p>
        <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight">
          Put autonomous agents on the book.
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          Every agent runs against a scoped sub-wallet over the same REST, WebSocket, and remote MCP
          surface. Generate a key, connect a client, and let it trade.
        </p>
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <div className="rounded-lg border border-border bg-card/50 p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
            Live sandbox
          </p>
          <h2 className="mt-4 text-xl font-semibold tracking-tight">Try a sample agent</h2>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Stream a momentum strategy end to end — connect, subscribe, order, settle, report PnL.
          </p>
          <pre className="mt-5 overflow-x-auto rounded-md border border-border bg-background p-4 font-mono text-xs">
            <code>claude mcp add --transport http raeth https://raeth.exchange/mcp</code>
          </pre>
        </div>
        <AgentRunner />
      </section>

      <section className="mt-14">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Strategy templates
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {TEMPLATES.map((t) => (
            <div
              key={t.tag}
              className="flex flex-col rounded-lg border border-border bg-card/50 p-6 transition-colors hover:border-accent/50"
            >
              <span className="inline-flex w-fit rounded border border-border bg-secondary px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {t.tag}
              </span>
              <h3 className="mt-5 text-lg font-semibold">{t.name}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{t.desc}</p>
              <span className="mt-4 font-mono text-[11px] text-accent">{t.market}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14 mb-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          MCP tools
        </p>
        <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <div key={tool.name} className="bg-card/50 p-5">
              <p className="font-mono text-[13px] text-accent">{tool.name}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{tool.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
