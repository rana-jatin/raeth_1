import { createFileRoute, Link } from "@tanstack/react-router";
import { AgentRunner } from "../components/agent-runner";
import { Footer, Header, TopBanner } from "../components/site-chrome";
import { LiveStatsRibbon } from "../components/live-stats-ribbon";
import { getRequestOrigin } from "../lib/origin.functions";
import ogHome from "../assets/og/home.jpg";

export const Route = createFileRoute("/")({
  loader: async () => ({ origin: await getRequestOrigin() }),
  head: ({ loaderData }) => {
    const ogImage = `${loaderData?.origin ?? ""}${ogHome}`;
    return {
      meta: [
        { title: "RAETH — The trading terminal for autonomous market agents" },
        {
          name: "description",
          content:
            "Connect Claude or any MCP client, allocate a sub-wallet, and trade live BTC markets through the same exchange substrate humans inspect in the terminal.",
        },
        { property: "og:title", content: "RAETH — Agentic Exchange" },
        {
          property: "og:description",
          content:
            "The trading terminal for autonomous market agents. Live testnet for BTC binaries and perpetuals.",
        },
        { property: "og:type", content: "website" },
        { property: "og:url", content: "/" },
        { property: "og:image", content: ogImage },
        { name: "twitter:image", content: ogImage },
      ],
      links: [{ rel: "canonical", href: "/" }],
    };
  },
  component: Index,
});

const LAUNCH = [
  {
    n: "01",
    title: "Create account",
    body: "Fund the master wallet and start from the primary Dealer Terminal agent.",
  },
  {
    n: "02",
    title: "Connect agent",
    body: "Generate a remote MCP URL and scoped API key for automated trading.",
  },
  {
    n: "03",
    title: "Open terminal",
    body: "Watch book, chart, fills, positions, funding, and order entry in one view.",
  },
  {
    n: "04",
    title: "Browse markets",
    body: "BTC binaries, BTC perpetuals, and parlay surfaces built on the same ledger.",
  },
];

const MECHANICS = [
  {
    tag: "CLOB",
    title: "One ledger, one book",
    body: "Orders, fills, margin, fees, funding, and settlement flow through event-sourced projections.",
  },
  {
    tag: "RISK",
    title: "Real exchange controls",
    body: "Row-locked money paths, pre-trade checks, liquidation, ADL, and replay verification are part of the trading substrate.",
  },
  {
    tag: "REPLAY",
    title: "Deterministic settlement",
    body: "Every market window is reconstructable from the event log, so fills and payouts can be verified end to end.",
  },
];

function Index() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <TopBanner />
      <Header />
      <LiveStatsRibbon />
      <main className="mx-auto max-w-7xl px-6">
        <Hero />
        <LaunchSurface />
        <QuickstartAndMarkets />
        <VenueMechanics />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

function Hero() {
  return (
    <section className="mt-10 rounded-xl border border-border bg-card/40 p-8 md:p-12">
      <div className="grid gap-10 md:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
            RAETH / Agentic Exchange / Live Testnet
          </p>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl">
            The trading terminal for autonomous market agents.
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Connect Claude or any MCP client, allocate a sub-wallet, and trade live BTC markets
            through the same exchange substrate humans inspect in the terminal.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/trade"
              search={{ symbol: "BTC-PERP" }}
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Start trading
            </Link>
            <Link
              to="/trade"
              search={{ symbol: "BTC-PERP" }}
              className="rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
            >
              Open terminal
            </Link>
            <Link
              to="/docs"
              className="rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
            >
              Quickstart
            </Link>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <StatCard label="Testnet bankroll" value="$10,000" sub="per account" />
          <StatCard label="Live markets" value="BTC up/down + perp" sub="5-minute + continuous" />
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function LaunchSurface() {
  return (
    <section className="mt-16">
      <div className="flex items-end justify-between gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Launch surface
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">Run it live ↓</p>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {LAUNCH.map((card) => (
          <div
            key={card.n}
            className="group flex flex-col rounded-lg border border-border bg-card/50 p-5 transition-colors hover:border-accent/50"
          >
            <span className="inline-flex w-fit rounded border border-border bg-secondary px-2 py-1 font-mono text-xs">
              {card.n}
            </span>
            <h3 className="mt-12 text-base font-semibold">{card.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{card.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <div className="rounded-lg border border-border bg-card/50 p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
            Interactive sandbox
          </p>
          <h3 className="mt-4 text-xl font-semibold tracking-tight">
            Run a sample agent and watch it trade.
          </h3>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            This streams a momentum strategy against a live BTC Up/Down window — connect, subscribe,
            place an order, settle, and report PnL. The same event stream your real agents consume
            over WebSocket and MCP.
          </p>
          <ul className="mt-5 space-y-2 font-mono text-[12px] text-muted-foreground">
            <li>› wss stream + REST + remote MCP</li>
            <li>› deterministic settlement on the ledger</li>
            <li>› scoped sub-wallet, no real money</li>
          </ul>
        </div>
        <AgentRunner />
      </div>
    </section>
  );
}

function QuickstartAndMarkets() {
  return (
    <section className="mt-12 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="rounded-lg border border-border bg-card/50 p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Agent quickstart
        </p>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed">
          The exchange is exposed over REST, WebSocket, and a remote MCP server. Claude connects in
          one line:
        </p>
        <pre className="mt-5 overflow-x-auto rounded-md border border-border bg-background p-4 font-mono text-xs text-foreground">
          <code>claude mcp add --transport http raeth https://raeth.exchange/mcp</code>
        </pre>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            to="/docs"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
          >
            API reference
          </Link>
          <Link
            to="/docs"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
          >
            llms.txt
          </Link>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <MarketCard
          symbol="M"
          name="BTC Up/Down"
          desc="5-minute binaries · settles to BTC spot · fresh market every window"
        />
        <MarketCard
          symbol="M"
          name="BTC Perpetual"
          desc="Linear perp · hourly funding · cross + isolated margin"
        />
      </div>
    </section>
  );
}

function MarketCard({ symbol, name, desc }: { symbol: string; name: string; desc: string }) {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-border bg-card/50 p-6 transition-colors hover:border-accent/50">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded border border-border bg-secondary font-mono text-sm">
        {symbol}
      </span>
      <div className="mt-12">
        <h3 className="text-base font-semibold">{name}</h3>
        <div className="mt-2 flex items-end justify-between gap-3">
          <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">{desc}</p>
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-live">
            <span className="h-1.5 w-1.5 rounded-full bg-live" />
            Live
          </span>
        </div>
      </div>
    </div>
  );
}

function VenueMechanics() {
  return (
    <section className="mt-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        Venue mechanics
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {MECHANICS.map((m) => (
          <div key={m.tag} className="rounded-lg border border-border bg-card/50 p-6">
            <span className="inline-flex rounded border border-border bg-secondary px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {m.tag}
            </span>
            <h3 className="mt-6 text-xl font-semibold tracking-tight">{m.title}</h3>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{m.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="mt-16 overflow-hidden rounded-xl border border-border bg-card/50 p-10 text-center">
      <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight">
        Allocate a sub-wallet and put an agent on the book.
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-[15px] text-muted-foreground">
        Spin up the master wallet, scope an API key, and let your agents trade the same live markets
        you watch in the terminal.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link
          to="/agents"
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Create Account
        </Link>
        <Link
          to="/trade"
          search={{ symbol: "BTC-PERP" }}
          className="rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
        >
          Open terminal
        </Link>
      </div>
    </section>
  );
}
