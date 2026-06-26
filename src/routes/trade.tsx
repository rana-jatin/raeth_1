import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageShell } from "../components/site-chrome";
import {
  ChartSkeleton,
  OrderBookSkeleton,
  PanelErrorBoundary,
  useFeedStatus,
} from "../components/panel-states";
import { getRequestOrigin } from "../lib/origin.functions";
import ogTrade from "../assets/og/trade.jpg";
import {
  MARKETS,
  fmtPrice,
  getMarket,
  normalizeSymbol,
  useLiveMark,
  type MarketConfig,
} from "../lib/markets";

export const Route = createFileRoute("/trade")({
  validateSearch: (search: Record<string, unknown>): { symbol: string } => ({
    symbol: normalizeSymbol(search.symbol),
  }),
  loader: async () => ({ origin: await getRequestOrigin() }),
  head: ({ loaderData }) => {
    const ogImage = `${loaderData?.origin ?? ""}${ogTrade}`;
    return {
      meta: [
        { title: "Trade Terminal — RAETH Agentic Exchange" },
        {
          name: "description",
          content:
            "Live RAETH testnet trade terminal — switch markets, watch a live order book and chart, and stage simulated orders for BTC perpetuals and binaries.",
        },
        { property: "og:title", content: "Trade Terminal — RAETH" },
        {
          property: "og:description",
          content:
            "Switch markets, watch a live order book and chart, and stage simulated orders for BTC perpetuals and binaries.",
        },
        { property: "og:type", content: "website" },
        { property: "og:url", content: "/trade" },
        { property: "og:image", content: ogImage },
        { name: "twitter:image", content: ogImage },
      ],
      links: [{ rel: "canonical", href: "/trade" }],
    };
  },
  component: TradePage,
});

type Side = "BUY" | "SELL";
type Order = "LIMIT" | "MARKET";

function TradePage() {
  const { symbol } = Route.useSearch();
  const market = getMarket(symbol);
  const mark = useLiveMark(market);

  return (
    <PageShell>
      <section className="mt-6 mb-4">
        <MarketSwitcher active={market.symbol} />

        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              RAETH / Terminal / {market.symbol}
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">{market.name}</h1>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{market.kind}</p>
          </div>
          <MarkRibbon market={market} mark={mark} />
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[260px_1fr_320px]">
          <PanelErrorBoundary title="Order book unavailable">
            <OrderBook market={market} mark={mark} />
          </PanelErrorBoundary>
          <PanelErrorBoundary title="Chart unavailable">
            <ChartPanel market={market} mark={mark} />
          </PanelErrorBoundary>
          <OrderTicket market={market} mark={mark} />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <RecentFills market={market} mark={mark} />
          <PositionsTable />
        </div>
      </section>
    </PageShell>
  );
}

function MarketSwitcher({ active }: { active: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MARKETS.map((m) => (
        <Link
          key={m.symbol}
          to="/trade"
          search={{ symbol: m.symbol }}
          className={`rounded-md border px-3 py-1.5 font-mono text-[11px] transition-colors ${
            m.symbol === active
              ? "border-accent/60 bg-accent/10 text-foreground"
              : "border-border text-muted-foreground hover:border-accent/40 hover:text-foreground"
          }`}
        >
          {m.symbol}
        </Link>
      ))}
    </div>
  );
}

function MarkRibbon({ market, mark }: { market: MarketConfig; mark: number }) {
  if (market.type === "perp") {
    return (
      <div className="flex flex-wrap items-center gap-5 font-mono text-xs tabular-nums">
        <Stat k="Mark" v={fmtPrice(market, mark)} />
        <Stat k="Index" v={fmtPrice(market, mark - 1.4)} />
        <Stat k="Funding 1h" v="+0.0042%" />
        <Stat k="24h" v={market.change} pos={market.up} />
        <Stat k="OI" v="$12.4m" />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-5 font-mono text-xs tabular-nums">
      <Stat k="Mark" v={fmtPrice(market, mark)} />
      <Stat k="Implied" v={`${(mark * 100).toFixed(1)}%`} />
      <Stat k="Window" v={market.window ?? "—"} />
      <Stat k="24h" v={market.change} pos={market.up} />
      <Stat k="Volume" v={market.vol} />
    </div>
  );
}

function Stat({ k, v, pos }: { k: string; v: string; pos?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</span>
      <span className={pos === undefined ? "text-foreground" : pos ? "text-live" : "text-destructive"}>
        {v}
      </span>
    </div>
  );
}

function OrderBook({ market, mark }: { market: MarketConfig; mark: number }) {
  const [seed, setSeed] = useState(0);
  const status = useFeedStatus(market.symbol);
  useEffect(() => {
    const id = setInterval(() => setSeed((s) => s + 1), 900);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    void seed;
    const asks = Array.from({ length: 9 }, (_, i) => ({
      px: mark + (i + 1) * market.tick,
      qty: +(Math.random() * 4 + 0.2).toFixed(2),
    })).reverse();
    const bids = Array.from({ length: 9 }, (_, i) => ({
      px: mark - (i + 1) * market.tick,
      qty: +(Math.random() * 4 + 0.2).toFixed(2),
    }));
    return { asks, bids };
  }, [mark, seed, market]);

  if (status === "loading") return <OrderBookSkeleton />;


  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <p className="px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        Order book
      </p>
      <div className="mt-2 grid grid-cols-2 px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Price</span>
        <span className="text-right">Size</span>
      </div>
      <div className="mt-1 space-y-0.5 font-mono text-xs tabular-nums">
        {rows.asks.map((r, i) => (
          <div key={`a-${i}`} className="relative grid grid-cols-2 px-1 py-0.5">
            <span
              className="absolute inset-y-0 right-0 bg-destructive/10"
              style={{ width: `${Math.min(100, r.qty * 22)}%` }}
            />
            <span className="relative text-destructive">{fmtPrice(market, r.px)}</span>
            <span className="relative text-right text-muted-foreground">{r.qty}</span>
          </div>
        ))}
        <div className="my-1 flex items-center justify-between border-y border-border px-1 py-1 font-mono text-[11px]">
          <span className="text-foreground">{fmtPrice(market, mark)}</span>
          <span className="text-muted-foreground">spread {fmtPrice(market, market.tick)}</span>
        </div>
        {rows.bids.map((r, i) => (
          <div key={`b-${i}`} className="relative grid grid-cols-2 px-1 py-0.5">
            <span
              className="absolute inset-y-0 right-0 bg-live/10"
              style={{ width: `${Math.min(100, r.qty * 22)}%` }}
            />
            <span className="relative text-live">{fmtPrice(market, r.px)}</span>
            <span className="relative text-right text-muted-foreground">{r.qty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
const TF_DRIFT: Record<Timeframe, number> = { "1m": 1, "5m": 1.8, "15m": 2.6, "1h": 3.6, "4h": 5 };

function ChartPanel({ market, mark }: { market: MarketConfig; mark: number }) {
  const [tf, setTf] = useState<Timeframe>("1m");
  const [series, setSeries] = useState<number[]>([]);
  const status = useFeedStatus(market.symbol);

  // Seed a fresh series whenever the market or timeframe changes.
  useEffect(() => {
    const n = 72;
    const step = market.volatility * TF_DRIFT[tf];
    let v = market.base;
    const arr: number[] = [];
    for (let i = 0; i < n; i++) {
      v += (Math.random() - 0.5) * step;
      if (market.type !== "perp") v = Math.min(0.95, Math.max(0.05, v));
      arr.push(v);
    }
    setSeries(arr);
  }, [market, tf]);

  // Append the live mark so the line keeps moving.
  useEffect(() => {
    setSeries((prev) => (prev.length ? [...prev.slice(1), mark] : prev));
  }, [mark]);

  const { path, area, lo, hi } = useMemo(() => {
    if (series.length < 2) return { path: "", area: "", lo: 0, hi: 0 };
    const lo = Math.min(...series);
    const hi = Math.max(...series);
    const span = hi - lo || 1;
    const stepX = 600 / (series.length - 1);
    const pts = series.map((val, i) => {
      const x = i * stepX;
      const y = 90 - ((val - lo) / span) * 78 - 6;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const path = `M ${pts.join(" L ")}`;
    return { path, area: `${path} L 600,100 L 0,100 Z`, lo, hi };
  }, [series]);

  const open = series[0] ?? market.base;
  const close = series[series.length - 1] ?? market.base;
  const up = close >= open;

  if (status === "loading" || series.length < 2)
    return <ChartSkeleton label={`${market.symbol} · ${tf}`} />;


  return (
    <div className="flex flex-col rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center justify-between px-1">
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {market.symbol} · {tf}
        </p>
        <div className="flex gap-1 font-mono text-[10px] text-muted-foreground">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTf(t)}
              className={`rounded border border-border px-1.5 py-0.5 transition-colors hover:bg-secondary ${
                t === tf ? "bg-secondary text-foreground" : ""
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox="0 0 600 100" preserveAspectRatio="none" className="mt-2 h-56 w-full">
        <defs>
          <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.78 0.16 152)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="oklch(0.78 0.16 152)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {area && <path d={area} fill="url(#chart-fill)" />}
        {path && <path d={path} fill="none" stroke="oklch(0.78 0.16 152)" strokeWidth="1.2" />}
      </svg>
      <div className="mt-auto grid grid-cols-4 gap-2 border-t border-border px-1 pt-2 font-mono text-[11px] tabular-nums text-muted-foreground">
        <span>O {fmtPrice(market, open)}</span>
        <span>H {fmtPrice(market, hi || close)}</span>
        <span>L {fmtPrice(market, lo || open)}</span>
        <span className={up ? "text-live" : "text-destructive"}>C {fmtPrice(market, close)}</span>
      </div>
    </div>
  );
}

function OrderTicket({ market, mark }: { market: MarketConfig; mark: number }) {
  const [side, setSide] = useState<Side>("BUY");
  const [order, setOrder] = useState<Order>("LIMIT");
  const [price, setPrice] = useState(fmtPrice(market, market.base).replace(/,/g, ""));
  const [qty, setQty] = useState(market.type === "perp" ? "0.10" : "100");
  const [lev, setLev] = useState(5);
  const [submitted, setSubmitted] = useState<null | { id: string; side: Side }>(null);

  const isPerp = market.type === "perp";
  const sizeLabel = isPerp ? "Size (BTC)" : "Size (shares)";

  // Reset the ticket when the market changes.
  useEffect(() => {
    setPrice(fmtPrice(market, market.base).replace(/,/g, ""));
    setQty(market.type === "perp" ? "0.10" : "100");
    setSubmitted(null);
  }, [market]);

  const effectivePrice = order === "MARKET" ? mark : parseFloat(price || "0");
  const notional = (effectivePrice * parseFloat(qty || "0")).toFixed(2);
  const margin = (parseFloat(notional) / Math.max(1, isPerp ? lev : 1)).toFixed(2);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted({ id: `ord_${Math.random().toString(36).slice(2, 8)}`, side });
    setTimeout(() => setSubmitted(null), 3500);
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card/50 p-3"
    >
      <p className="px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        Order ticket · {market.symbol}
      </p>
      <div className="grid grid-cols-2 gap-1 rounded-md border border-border p-1">
        {(["BUY", "SELL"] as Side[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`rounded py-1.5 font-mono text-xs ${
              side === s
                ? s === "BUY"
                  ? "bg-live/15 text-live"
                  : "bg-destructive/15 text-destructive"
                : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex gap-1 font-mono text-[11px]">
        {(["LIMIT", "MARKET"] as Order[]).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOrder(o)}
            className={`flex-1 rounded border border-border py-1 ${
              order === o ? "bg-secondary text-foreground" : "text-muted-foreground"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Price ({isPerp ? "USD" : "prob"})
        </span>
        <input
          value={order === "MARKET" ? "—" : price}
          disabled={order === "MARKET"}
          onChange={(e) => setPrice(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1.5 font-mono text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {sizeLabel}
        </span>
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1.5 font-mono text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      {isPerp && (
        <label className="flex flex-col gap-1">
          <span className="flex justify-between font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>Leverage</span>
            <span className="text-foreground">{lev}×</span>
          </span>
          <input
            type="range"
            min={1}
            max={25}
            value={lev}
            onChange={(e) => setLev(parseInt(e.target.value))}
            className="accent-[color:oklch(0.78_0.16_152)]"
          />
        </label>
      )}
      <div className="space-y-1 rounded-md border border-border bg-background/50 p-2 font-mono text-[11px] tabular-nums text-muted-foreground">
        <div className="flex justify-between">
          <span>Notional</span>
          <span className="text-foreground">${notional}</span>
        </div>
        <div className="flex justify-between">
          <span>{isPerp ? "Margin" : "Max payout"}</span>
          <span className="text-foreground">
            ${isPerp ? margin : parseFloat(qty || "0").toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Fee (taker 0.05%)</span>
          <span className="text-foreground">${(parseFloat(notional) * 0.0005).toFixed(2)}</span>
        </div>
      </div>
      <button
        type="submit"
        className={`rounded-md py-2 font-mono text-sm font-medium ${
          side === "BUY"
            ? "bg-live text-accent-foreground hover:opacity-90"
            : "bg-destructive text-destructive-foreground hover:opacity-90"
        }`}
      >
        {side} {qty} {market.symbol}
      </button>
      {submitted && (
        <p className="rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
          <span className="text-live">●</span> simulated {submitted.side} fill ·{" "}
          <span className="text-foreground">{submitted.id}</span>
        </p>
      )}
    </form>
  );
}

type Fill = { id: string; side: Side; px: number; qty: number; t: number };

function makeFill(market: MarketConfig, mark: number): Fill {
  return {
    id: Math.random().toString(36).slice(2, 8),
    side: Math.random() > 0.5 ? "BUY" : "SELL",
    px: mark + (Math.random() - 0.5) * market.tick * 6,
    qty:
      market.type === "perp"
        ? +(0.02 + Math.random() * 1.2).toFixed(2)
        : +(5 + Math.random() * 80).toFixed(0),
    t: Date.now(),
  };
}

function RecentFills({ market, mark }: { market: MarketConfig; mark: number }) {
  const [fills, setFills] = useState<Fill[]>([]);

  // Reset the tape when the market changes.
  useEffect(() => {
    setFills(Array.from({ length: 8 }, () => makeFill(market, market.base)));
  }, [market]);

  useEffect(() => {
    const id = setInterval(() => {
      setFills((prev) => [makeFill(market, mark), ...prev].slice(0, 10));
    }, 2200);
    return () => clearInterval(id);
    // mark intentionally excluded — interval reads the latest via closure recreate
  }, [market, mark]);

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <p className="px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        Recent fills
      </p>
      <div className="mt-2 grid grid-cols-4 px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Side</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>
      <div className="mt-1 divide-y divide-border font-mono text-xs tabular-nums">
        {fills.map((f) => (
          <div key={f.id} className="grid grid-cols-4 px-1 py-1">
            <span className={f.side === "BUY" ? "text-live" : "text-destructive"}>{f.side}</span>
            <span className="text-right">{fmtPrice(market, f.px)}</span>
            <span className="text-right text-muted-foreground">{f.qty}</span>
            <span className="text-right text-muted-foreground">
              {new Date(f.t).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PositionsTable() {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <p className="px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        Positions
      </p>
      <div className="mt-2 grid grid-cols-5 px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Market</span>
        <span className="text-right">Side</span>
        <span className="text-right">Size</span>
        <span className="text-right">Entry</span>
        <span className="text-right">PnL</span>
      </div>
      <div className="mt-1 divide-y divide-border font-mono text-xs tabular-nums">
        <div className="grid grid-cols-5 px-1 py-2">
          <span>BTC-PERP</span>
          <span className="text-right text-live">LONG</span>
          <span className="text-right">0.42</span>
          <span className="text-right">64,812.0</span>
          <span className="text-right text-live">+$50.10</span>
        </div>
        <div className="grid grid-cols-5 px-1 py-2">
          <span>BTC-UPDOWN</span>
          <span className="text-right text-destructive">SHORT</span>
          <span className="text-right">35</span>
          <span className="text-right">0.524</span>
          <span className="text-right text-destructive">−$3.20</span>
        </div>
      </div>
    </div>
  );
}
