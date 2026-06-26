import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell } from "../components/site-chrome";
import { MARKETS, fmtPrice, getMarket } from "../lib/markets";
import { getRequestOrigin } from "../lib/origin.functions";
import ogMarkets from "../assets/og/markets.jpg";

export const Route = createFileRoute("/markets")({
  loader: async () => ({ origin: await getRequestOrigin() }),
  head: ({ loaderData }) => {
    const ogImage = `${loaderData?.origin ?? ""}${ogMarkets}`;
    return {
      meta: [
        { title: "Markets — RAETH Agentic Exchange" },
        {
          name: "description",
          content:
            "Live BTC Up/Down binaries, BTC perpetuals, and parlay surfaces — all settled on a single event-sourced ledger.",
        },
        { property: "og:title", content: "Markets — RAETH" },
        {
          property: "og:description",
          content: "Live BTC binaries and perpetuals on the RAETH testnet.",
        },
        { property: "og:type", content: "website" },
        { property: "og:url", content: "/markets" },
        { property: "og:image", content: ogImage },
        { name: "twitter:image", content: ogImage },
      ],
      links: [{ rel: "canonical", href: "/markets" }],
    };
  },
  component: MarketsPage,
});



function MarketsPage() {
  return (
    <PageShell>
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
          RAETH / Markets
        </p>
        <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight">
          Live markets on one ledger.
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          BTC binaries, perpetuals, and parlays share the same order book, margin engine, and
          deterministic settlement.
        </p>
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        <Stat label="24h volume" value="$4.53m" />
        <Stat label="Open markets" value="12" />
        <Stat label="Active agents" value="318" />
      </section>

      <section className="mt-10 mb-4 overflow-hidden rounded-lg border border-border">
        <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 border-b border-border bg-card px-5 py-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground sm:grid">
          <span>Market</span>
          <span className="text-right">Last</span>
          <span className="text-right">24h</span>
          <span className="text-right">Volume</span>
          <span className="text-right">Status</span>
        </div>
        <div className="divide-y divide-border">
          {MARKETS.map((m) => (
            <Link
              key={m.symbol}
              to="/trade"
              search={{ symbol: m.symbol }}
              className="grid grid-cols-2 gap-3 px-5 py-4 transition-colors hover:bg-card/50 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-center sm:gap-4"
            >
              <div>
                <p className="text-sm font-semibold">{m.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{m.kind}</p>
              </div>
              <p className="text-right font-mono text-sm">{fmtPrice(getMarket(m.symbol), m.base)}</p>
              <p
                className={`text-right font-mono text-sm ${m.up ? "text-live" : "text-destructive"}`}
              >
                {m.change}
              </p>
              <p className="text-right font-mono text-sm text-muted-foreground">{m.vol}</p>
              <span className="flex items-center justify-end gap-1.5 font-mono text-xs text-live">
                <span className="h-1.5 w-1.5 rounded-full bg-live" />
                Live
              </span>
            </Link>
          ))}
        </div>
      </section>
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold">{value}</p>
    </div>
  );
}
