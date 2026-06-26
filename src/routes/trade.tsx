import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "../components/site-chrome";
import {
  ChartSkeleton,
  OrderBookSkeleton,
  PanelErrorBoundary,
  useFeedStatus,
} from "../components/panel-states";
import { Slider } from "../components/ui/slider";
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
            "Live RAETH testnet trade terminal — glass-box agent thought stream and time-travel debugger over a simulated BTC order book.",
        },
        { property: "og:title", content: "Trade Terminal — RAETH" },
        {
          property: "og:description",
          content:
            "Glass-box agent thought stream and time-travel debugger over a simulated BTC order book.",
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

type BookLevel = { px: number; qty: number };
type Snapshot = {
  id: number;
  t: number;
  mark: number;
  bids: BookLevel[];
  asks: BookLevel[];
  /** Indicator readouts the agent saw at this instant. */
  ind: { ema: number; rsi: number; imb: number; vol: number };
};

type Trigger = { label: string; value: string; pass: boolean };
type Decision = {
  id: string;
  frameId: number;
  t: number;
  side: Side;
  px: number;
  qty: number;
  conviction: number; // 0..1
  monologue: string;
  triggers: Trigger[];
};

const FRAME_CAP = 180;
const FRAME_MS = 850;

function makeBook(market: MarketConfig, mark: number) {
  const asks = Array.from({ length: 9 }, (_, i) => ({
    px: mark + (i + 1) * market.tick,
    qty: +(Math.random() * 4 + 0.2).toFixed(2),
  })).reverse();
  const bids = Array.from({ length: 9 }, (_, i) => ({
    px: mark - (i + 1) * market.tick,
    qty: +(Math.random() * 4 + 0.2).toFixed(2),
  }));
  return { asks, bids };
}

function bookImbalance(b: BookLevel[], a: BookLevel[]) {
  const bq = b.reduce((s, r) => s + r.qty, 0);
  const aq = a.reduce((s, r) => s + r.qty, 0);
  const total = bq + aq || 1;
  return (bq - aq) / total; // -1..1
}

function TradePage() {
  const { symbol } = Route.useSearch();
  const market = getMarket(symbol);
  const mark = useLiveMark(market);

  const [frames, setFrames] = useState<Snapshot[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [viewId, setViewId] = useState<number | null>(null); // null = live
  const frameSeq = useRef(0);
  const lastDecision = useRef(0);

  // Reset history when the market changes.
  useEffect(() => {
    setFrames([]);
    setDecisions([]);
    setViewId(null);
    frameSeq.current = 0;
    lastDecision.current = 0;
  }, [market]);

  // Drive a single shared tick that produces snapshots + occasional agent decisions.
  useEffect(() => {
    const id = setInterval(() => {
      setFrames((prev) => {
        const { asks, bids } = makeBook(market, mark);
        const prevMark = prev.length ? prev[prev.length - 1].mark : mark;
        const ema = prev.length
          ? prev[prev.length - 1].ind.ema * 0.85 + mark * 0.15
          : mark;
        const drift = mark - prevMark;
        const rsi = Math.max(5, Math.min(95, 50 + drift * 800));
        const imb = bookImbalance(bids, asks);
        const vol = Math.abs(drift) / Math.max(1e-6, market.volatility);
        const snap: Snapshot = {
          id: ++frameSeq.current,
          t: Date.now(),
          mark,
          bids,
          asks,
          ind: { ema, rsi, imb, vol },
        };

        // Agent decision logic — fires when several signals align.
        const sinceLast = snap.t - lastDecision.current;
        if (sinceLast > 2600 && Math.random() > 0.55) {
          const bullish = imb > 0.08 && mark > ema && rsi < 70;
          const bearish = imb < -0.08 && mark < ema && rsi > 30;
          if (bullish || bearish) {
            lastDecision.current = snap.t;
            const side: Side = bullish ? "BUY" : "SELL";
            const conviction = Math.min(
              0.99,
              0.45 + Math.abs(imb) * 1.6 + Math.abs(mark - ema) / (ema || 1) * 60,
            );
            const triggers: Trigger[] = [
              {
                label: "Book imbalance",
                value: `${(imb * 100).toFixed(1)}%`,
                pass: bullish ? imb > 0.08 : imb < -0.08,
              },
              {
                label: "Mark vs EMA(20)",
                value: `${(((mark - ema) / (ema || 1)) * 100).toFixed(2)}%`,
                pass: bullish ? mark > ema : mark < ema,
              },
              {
                label: "RSI(14)",
                value: rsi.toFixed(1),
                pass: bullish ? rsi < 70 : rsi > 30,
              },
              {
                label: "Vol regime",
                value: vol.toFixed(2),
                pass: vol < 2.2,
              },
            ];
            const qty = market.type === "perp"
              ? +(0.05 + conviction * 0.6).toFixed(2)
              : +(20 + conviction * 120).toFixed(0);
            const monologue = bullish
              ? `Bid stack outweighs offers (${(imb * 100).toFixed(1)}% imbalance) while mark sits ${(((mark - ema) / (ema || 1)) * 1e4).toFixed(0)}bps above EMA(20). RSI ${rsi.toFixed(0)} leaves room before overbought. Lifting ${qty} ${market.symbol} at ${fmtPrice(market, mark)} with conviction ${(conviction * 100).toFixed(0)}%.`
              : `Offers dominate (${(imb * 100).toFixed(1)}% imbalance) and mark broke ${(((ema - mark) / (ema || 1)) * 1e4).toFixed(0)}bps under EMA(20). RSI ${rsi.toFixed(0)} not yet oversold — fading strength. Hitting bid for ${qty} ${market.symbol} at ${fmtPrice(market, mark)}, conviction ${(conviction * 100).toFixed(0)}%.`;
            const decision: Decision = {
              id: `ord_${snap.id.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
              frameId: snap.id,
              t: snap.t,
              side,
              px: mark,
              qty,
              conviction,
              monologue,
              triggers,
            };
            setDecisions((d) => [decision, ...d].slice(0, 40));
          }
        }

        const next = [...prev, snap];
        if (next.length > FRAME_CAP) next.splice(0, next.length - FRAME_CAP);
        return next;
      });
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [market, mark]);

  const liveFrame = frames[frames.length - 1];
  const viewFrame =
    viewId === null
      ? liveFrame
      : frames.find((f) => f.id === viewId) ?? liveFrame;
  const isLive = viewId === null;

  const jumpToDecision = useCallback((d: Decision) => {
    setViewId(d.frameId);
  }, []);

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
          <MarkRibbon market={market} mark={viewFrame?.mark ?? mark} isLive={isLive} />
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[260px_1fr_320px]">
          <PanelErrorBoundary title="Order book unavailable">
            <OrderBook market={market} frame={viewFrame} isLive={isLive} />
          </PanelErrorBoundary>
          <PanelErrorBoundary title="Chart unavailable">
            <ChartPanel
              market={market}
              frames={frames}
              viewId={viewId}
              onScrub={setViewId}
              isLive={isLive}
              decisions={decisions}
            />
          </PanelErrorBoundary>
          <OrderTicket market={market} mark={mark} />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <ThoughtStream
            market={market}
            decisions={decisions}
            activeFrameId={viewFrame?.id ?? null}
            onJump={jumpToDecision}
          />
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

function MarkRibbon({
  market,
  mark,
  isLive,
}: {
  market: MarketConfig;
  mark: number;
  isLive: boolean;
}) {
  const tag = isLive ? (
    <span className="rounded border border-live/40 bg-live/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-live">
      ● live
    </span>
  ) : (
    <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">
      ⏪ rewind
    </span>
  );
  if (market.type === "perp") {
    return (
      <div className="flex flex-wrap items-center gap-5 font-mono text-xs tabular-nums">
        {tag}
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
      {tag}
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

function OrderBook({
  market,
  frame,
  isLive,
}: {
  market: MarketConfig;
  frame: Snapshot | undefined;
  isLive: boolean;
}) {
  const status = useFeedStatus(market.symbol);
  if (status === "loading" || !frame) return <OrderBookSkeleton />;

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center justify-between px-1">
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Order book
        </p>
        {!isLive && (
          <p className="font-mono text-[10px] uppercase tracking-wide text-accent">
            snapshot @ {new Date(frame.t).toLocaleTimeString([], { hour12: false })}
          </p>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Price</span>
        <span className="text-right">Size</span>
      </div>
      <div className="mt-1 space-y-0.5 font-mono text-xs tabular-nums">
        {frame.asks.map((r, i) => (
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
          <span className="text-foreground">{fmtPrice(market, frame.mark)}</span>
          <span className="text-muted-foreground">spread {fmtPrice(market, market.tick)}</span>
        </div>
        {frame.bids.map((r, i) => (
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

function ChartPanel({
  market,
  frames,
  viewId,
  onScrub,
  isLive,
  decisions,
}: {
  market: MarketConfig;
  frames: Snapshot[];
  viewId: number | null;
  onScrub: (id: number | null) => void;
  isLive: boolean;
  decisions: Decision[];
}) {
  const status = useFeedStatus(market.symbol);

  const visibleEnd = useMemo(() => {
    if (viewId === null) return frames.length;
    const idx = frames.findIndex((f) => f.id === viewId);
    return idx === -1 ? frames.length : idx + 1;
  }, [frames, viewId]);

  const series = useMemo(
    () => frames.slice(0, visibleEnd).map((f) => f.mark),
    [frames, visibleEnd],
  );

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

  // Project decision markers into chart-space using only the visible window.
  const visible = frames.slice(0, visibleEnd);
  const markers = useMemo(() => {
    if (visible.length < 2) return [] as { x: number; y: number; d: Decision }[];
    const lo2 = Math.min(...visible.map((f) => f.mark));
    const hi2 = Math.max(...visible.map((f) => f.mark));
    const span = hi2 - lo2 || 1;
    const stepX = 600 / (visible.length - 1);
    return decisions
      .map((d) => {
        const idx = visible.findIndex((f) => f.id === d.frameId);
        if (idx === -1) return null;
        return {
          x: idx * stepX,
          y: 90 - ((d.px - lo2) / span) * 78 - 6,
          d,
        };
      })
      .filter(Boolean) as { x: number; y: number; d: Decision }[];
  }, [visible, decisions]);

  const close = series[series.length - 1] ?? market.base;
  const open = series[0] ?? market.base;
  const up = close >= open;

  if (status === "loading" || series.length < 2)
    return <ChartSkeleton label={`${market.symbol} · time-travel`} />;

  const sliderMax = Math.max(1, frames.length);
  const sliderVal = viewId === null ? sliderMax : visibleEnd;
  const viewFrame = frames[visibleEnd - 1];

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center justify-between px-1">
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {market.symbol} · glass-box chart
        </p>
        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          {isLive ? (
            <span className="text-live">● streaming</span>
          ) : (
            <button
              type="button"
              onClick={() => onScrub(null)}
              className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-accent hover:bg-accent/20"
            >
              return to live
            </button>
          )}
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
        {markers.map(({ x, y, d }) => (
          <g key={d.id} onClick={() => onScrub(d.frameId)} className="cursor-pointer">
            <line
              x1={x}
              x2={x}
              y1={0}
              y2={100}
              stroke={d.side === "BUY" ? "oklch(0.78 0.16 152)" : "oklch(0.65 0.22 25)"}
              strokeOpacity={d.frameId === viewId ? 0.7 : 0.18}
              strokeWidth={d.frameId === viewId ? 0.8 : 0.4}
            />
            <circle
              cx={x}
              cy={y}
              r={d.frameId === viewId ? 1.8 : 1.2}
              fill={d.side === "BUY" ? "oklch(0.78 0.16 152)" : "oklch(0.65 0.22 25)"}
            />
          </g>
        ))}
      </svg>
      <div className="mt-2 flex items-center gap-3 px-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          T-{frames.length - visibleEnd}
        </span>
        <Slider
          value={[sliderVal]}
          min={1}
          max={sliderMax}
          step={1}
          onValueChange={([v]) => {
            if (v >= sliderMax) onScrub(null);
            else {
              const f = frames[v - 1];
              if (f) onScrub(f.id);
            }
          }}
          className="flex-1"
        />
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {viewFrame
            ? new Date(viewFrame.t).toLocaleTimeString([], { hour12: false })
            : "—"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 border-t border-border px-1 pt-2 font-mono text-[11px] tabular-nums text-muted-foreground">
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

function ThoughtStream({
  market,
  decisions,
  activeFrameId,
  onJump,
}: {
  market: MarketConfig;
  decisions: Decision[];
  activeFrameId: number | null;
  onJump: (d: Decision) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center justify-between px-1">
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Agent thought stream
        </p>
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {decisions.length} decisions
        </p>
      </div>
      {decisions.length === 0 ? (
        <p className="mt-6 px-1 pb-4 text-center font-mono text-[11px] text-muted-foreground">
          waiting for agent to find an edge…
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border font-mono text-xs">
          {decisions.map((d) => {
            const isOpen = open === d.id;
            const isActive = activeFrameId === d.frameId;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : d.id)}
                  className={`grid w-full grid-cols-[60px_70px_1fr_70px_70px] items-center gap-2 px-1 py-2 text-left tabular-nums transition-colors hover:bg-secondary/50 ${
                    isActive ? "bg-accent/5" : ""
                  }`}
                >
                  <span className={d.side === "BUY" ? "text-live" : "text-destructive"}>
                    {d.side}
                  </span>
                  <span className="text-muted-foreground">{d.qty}</span>
                  <span className="truncate text-foreground/80">{d.id}</span>
                  <span className="text-right text-muted-foreground">
                    {fmtPrice(market, d.px)}
                  </span>
                  <span className="text-right text-muted-foreground">
                    {new Date(d.t).toLocaleTimeString([], { hour12: false })}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-border bg-background/40 px-3 py-3 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-[10px] uppercase tracking-wide text-accent">
                        Inner monologue
                      </p>
                      <button
                        type="button"
                        onClick={() => onJump(d)}
                        className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent hover:bg-accent/20"
                      >
                        rewind chart →
                      </button>
                    </div>
                    <p className="font-mono text-[11px] leading-relaxed text-foreground/80">
                      {d.monologue}
                    </p>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        Triggers ({d.triggers.filter((t) => t.pass).length}/{d.triggers.length} pass) · conviction {(d.conviction * 100).toFixed(0)}%
                      </p>
                      <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                        {d.triggers.map((t) => (
                          <li
                            key={t.label}
                            className="flex items-center justify-between rounded border border-border bg-background/60 px-2 py-1 font-mono text-[11px] tabular-nums"
                          >
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <span
                                className={
                                  t.pass ? "text-live" : "text-destructive"
                                }
                              >
                                {t.pass ? "●" : "○"}
                              </span>
                              {t.label}
                            </span>
                            <span className="text-foreground">{t.value}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
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