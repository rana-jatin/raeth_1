import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward, Gauge } from "lucide-react";
import { PageShell } from "../components/site-chrome";
import {
  ChartSkeleton,
  OrderBookSkeleton,
  PanelErrorBoundary,
  useFeedStatus,
} from "../components/panel-states";
import { Slider } from "../components/ui/slider";
import { RiskFirewall } from "../components/risk-firewall";
import { getRequestOrigin } from "../lib/origin.functions";
import ogTrade from "../assets/og/trade.jpg";
import { MARKETS, fmtPrice, getMarket, normalizeSymbol, type MarketConfig } from "../lib/markets";
import { createBotState } from "../lib/agents/presets";
import { evaluateRisk, withBlockedRecorded, withSubmissionRecorded } from "../lib/agents/risk";
import { applyFillToBot } from "../lib/agents/accounting";
import { recomputeMetrics } from "../lib/agents/metrics";
import type { BotState, DecisionDraft, RiskVerdict } from "../lib/agents/types";

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
type DecisionStatus = "pending" | "partial" | "filled" | "expired";
type Decision = {
  id: string;
  orderId?: number;
  frameId: number;
  t: number;
  side: Side;
  px: number;
  qty: number;
  conviction: number; // 0..1
  monologue: string;
  triggers: Trigger[];
  // Glass-box risk + PnL (#1)
  riskLimit: string;
  maxLossUsd: number;
  leverage: number;
  expectedPnl: number;
  actualPnl: number | null;
  status: DecisionStatus;
  // internal fill accounting
  _filledQty: number;
  _fillPx: number;
  _fees: number;
};

/** A discrete order-book event, recorded per frame for time-travel replay (#2). */
type TLEvent = {
  frameId: number;
  t: number;
  kind: "accepted" | "trade" | "cancelled" | "filled" | "blocked";
  text: string;
  side?: Side;
  agent?: boolean;
};

/** Loosely-typed event emitted by the matching worker (fields vary by kind). */
type WorkerEvent = {
  type: string;
  id: number;
  side: Side;
  price: number;
  qty: number;
  remaining: number;
  maker_id: number;
  taker_id: number;
};

const FRAME_CAP = 180;
const FRAME_MS = 850;
const TL_CAP = 240;
const DEC_CAP = 40;
const FEE_RATE = 0.0005;
const SPEEDS = [0.5, 1, 2, 4];

function bookImbalance(b: BookLevel[], a: BookLevel[]) {
  const bq = b.reduce((s, r) => s + r.qty, 0);
  const aq = a.reduce((s, r) => s + r.qty, 0);
  const total = bq + aq || 1;
  return (bq - aq) / total; // -1..1
}

function TradePage() {
  const { symbol } = Route.useSearch();
  const market = getMarket(symbol);

  const [frames, setFrames] = useState<Snapshot[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [timeline, setTimeline] = useState<TLEvent[]>([]);
  const [viewId, setViewId] = useState<number | null>(null); // null = live
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [agentBot, setAgentBot] = useState<BotState>(() => createBotState("momentum", market));
  const [lastVerdict, setLastVerdict] = useState<RiskVerdict | null>(null);
  const [userOrders, setUserOrders] = useState<
    Record<number, { id: number; side: Side; price: number; qty: number; remaining: number }>
  >({});
  const [positions, setPositions] = useState<
    Record<string, { side: Side | null; size: number; entry: number }>
  >({});
  const [userTrades, setUserTrades] = useState<
    { id: string; side: Side; price: number; qty: number; t: number; symbol: string }[]
  >([]);
  const [mark, setMark] = useState(market.base);

  const framesRef = useRef<Snapshot[]>([]);
  const decisionsRef = useRef<Decision[]>([]);
  const decisionMapRef = useRef<Map<string, Decision>>(new Map());
  const agentOrderToDecisionRef = useRef<Map<number, string>>(new Map());
  const agentBotRef = useRef<BotState>(agentBot);
  const frameSeq = useRef(0);
  const decSeq = useRef(0);
  const lastDecision = useRef(0);
  const pendingDecisionRef = useRef<Omit<
    Decision,
    | "id"
    | "orderId"
    | "t"
    | "px"
    | "qty"
    | "actualPnl"
    | "status"
    | "_filledQty"
    | "_fillPx"
    | "_fees"
  > | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const flushDecisions = useCallback(() => {
    setDecisions(decisionsRef.current.map((d) => ({ ...d })));
  }, []);

  const reconcileAgentDecision = useCallback((decId: string, price: number, qty: number) => {
    const dec = decisionMapRef.current.get(decId);
    if (!dec) return;
    const newQty = dec._filledQty + qty;
    dec._fillPx = newQty > 0 ? (dec._fillPx * dec._filledQty + price * qty) / newQty : price;
    dec._filledQty = newQty;
    dec._fees += price * qty * FEE_RATE;
    dec.status = dec._filledQty >= dec.qty - 1e-9 ? "filled" : "partial";
  }, []);

  // Scan events: update user state, agent fills, decisions, and the replay timeline.
  const processEvents = useCallback(
    (
      events: WorkerEvent[],
      symbolStr: string,
      frameId: number,
      isUserOrder?: boolean,
      isAgentOrder?: boolean,
    ) => {
      const tl: TLEvent[] = [];
      let decisionsTouched = false;

      events.forEach((ev) => {
        if (ev.type === "accepted") {
          tl.push({
            frameId,
            t: Date.now(),
            kind: "accepted",
            side: ev.side,
            text: `order ${ev.id} accepted · ${ev.side} ${ev.qty} @ ${ev.price}`,
            agent: isAgentOrder,
          });
          if (isUserOrder) {
            setUserOrders((prev) => ({
              ...prev,
              [ev.id]: {
                id: ev.id,
                side: ev.side,
                price: ev.price,
                qty: ev.qty,
                remaining: ev.qty,
              },
            }));
          } else if (isAgentOrder && pendingDecisionRef.current) {
            const d0 = pendingDecisionRef.current;
            const decision: Decision = {
              id: `dec_${(++decSeq.current).toString().padStart(5, "0")}`,
              orderId: ev.id,
              frameId: d0.frameId,
              t: Date.now(),
              side: d0.side,
              px: ev.price,
              qty: ev.qty,
              conviction: d0.conviction,
              monologue: d0.monologue,
              triggers: d0.triggers,
              riskLimit: d0.riskLimit,
              maxLossUsd: d0.maxLossUsd,
              leverage: d0.leverage,
              expectedPnl: d0.expectedPnl,
              actualPnl: null,
              status: "pending",
              _filledQty: 0,
              _fillPx: 0,
              _fees: 0,
            };
            decisionsRef.current = [decision, ...decisionsRef.current].slice(0, DEC_CAP);
            decisionMapRef.current.set(decision.id, decision);
            agentOrderToDecisionRef.current.set(ev.id, decision.id);
            decisionsTouched = true;
            pendingDecisionRef.current = null;
          }
        } else if (ev.type === "trade") {
          const makerDec = agentOrderToDecisionRef.current.get(ev.maker_id);
          const takerDec = agentOrderToDecisionRef.current.get(ev.taker_id);
          if (makerDec || takerDec) {
            const isMaker = !!makerDec;
            const agentSide: Side = isMaker ? (ev.side === "BUY" ? "SELL" : "BUY") : ev.side;
            agentBotRef.current = applyFillToBot(
              agentBotRef.current,
              agentSide,
              ev.price,
              ev.qty,
            ).bot;
            reconcileAgentDecision((makerDec ?? takerDec)!, ev.price, ev.qty);
            decisionsTouched = true;
            tl.push({
              frameId,
              t: Date.now(),
              kind: "trade",
              side: agentSide,
              text: `agent fill · ${agentSide} ${ev.qty} @ ${ev.price}`,
              agent: true,
            });
          } else {
            tl.push({
              frameId,
              t: Date.now(),
              kind: "trade",
              side: ev.side,
              text: `trade · ${ev.qty} @ ${ev.price}`,
            });
          }

          // User position tracking (unchanged behavior).
          setUserOrders((prev) => {
            const next = { ...prev };
            const makerId = ev.maker_id;
            const takerId = ev.taker_id;
            let matchedUserOrder = false;
            let userSide: Side = "BUY";

            if (next[makerId]) {
              next[makerId].remaining = Math.max(0, next[makerId].remaining - ev.qty);
              if (next[makerId].remaining === 0) delete next[makerId];
              matchedUserOrder = true;
              userSide = next[makerId] ? next[makerId].side : ev.side === "BUY" ? "SELL" : "BUY";
            }
            if (next[takerId]) {
              next[takerId].remaining = Math.max(0, next[takerId].remaining - ev.qty);
              if (next[takerId].remaining === 0) delete next[takerId];
              matchedUserOrder = true;
              userSide = ev.side;
            }

            if (matchedUserOrder) {
              setUserTrades((prevTrades) => [
                {
                  id: `trd_${makerId}_${takerId}`,
                  side: userSide,
                  price: ev.price,
                  qty: ev.qty,
                  t: Date.now(),
                  symbol: symbolStr,
                },
                ...prevTrades,
              ]);
              setPositions((prevPositions) => {
                const currentPos = prevPositions[symbolStr] || { side: null, size: 0, entry: 0 };
                const tradeQty = ev.qty;
                const tradePrice = ev.price;
                let newSide = currentPos.side;
                let newSize = currentPos.size;
                let newEntry = currentPos.entry;
                if (currentPos.side === null) {
                  newSide = userSide;
                  newSize = tradeQty;
                  newEntry = tradePrice;
                } else if (currentPos.side === userSide) {
                  newEntry =
                    (currentPos.entry * currentPos.size + tradePrice * tradeQty) /
                    (currentPos.size + tradeQty);
                  newSize = currentPos.size + tradeQty;
                } else {
                  if (currentPos.size > tradeQty) newSize = currentPos.size - tradeQty;
                  else if (currentPos.size === tradeQty) {
                    newSide = null;
                    newSize = 0;
                    newEntry = 0;
                  } else {
                    newSide = userSide;
                    newSize = tradeQty - currentPos.size;
                    newEntry = tradePrice;
                  }
                }
                return {
                  ...prevPositions,
                  [symbolStr]: {
                    side: newSide,
                    size: parseFloat(newSize.toFixed(4)),
                    entry: parseFloat(newEntry.toFixed(2)),
                  },
                };
              });
            }
            return next;
          });
        } else if (ev.type === "cancelled" || ev.type === "filled") {
          tl.push({
            frameId,
            t: Date.now(),
            kind: ev.type,
            side: ev.side,
            text: `order ${ev.id} ${ev.type}`,
          });
          const decId = agentOrderToDecisionRef.current.get(ev.id);
          if (ev.type === "cancelled" && decId) {
            const d = decisionMapRef.current.get(decId);
            if (d && d._filledQty <= 0) {
              d.status = "expired";
              d.actualPnl = 0;
              decisionsTouched = true;
            }
          }
          setUserOrders((prev) => {
            const next = { ...prev };
            if (next[ev.id]) delete next[ev.id];
            return next;
          });
        }
      });

      if (tl.length) setTimeline((prev) => [...tl.reverse(), ...prev].slice(0, TL_CAP));
      if (decisionsTouched) {
        setAgentBot(agentBotRef.current);
        flushDecisions();
      }
    },
    [flushDecisions, reconcileAgentDecision],
  );

  // Initialize Worker & handle state updates.
  useEffect(() => {
    const worker = new Worker(new URL("../workers/matching.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.postMessage({ type: "INIT" });

    worker.onmessage = (e) => {
      const { type, data, events, isUser, isAgent, error } = e.data;
      if (type === "INIT_DONE") {
        worker.postMessage({
          type: "RESET",
          data: { symbol: market.symbol, base: market.base, tick: market.tick, type: market.type },
        });
      } else if (type === "RESET_DONE") {
        framesRef.current = [];
        decisionsRef.current = [];
        decisionMapRef.current.clear();
        agentOrderToDecisionRef.current.clear();
        agentBotRef.current = createBotState("momentum", market);
        setFrames([]);
        setDecisions([]);
        setTimeline([]);
        setAgentBot(agentBotRef.current);
        setLastVerdict(null);
        setUserOrders({});
        setMark(market.base);
        setViewId(null);
        setPlaying(false);
        frameSeq.current = 0;
        lastDecision.current = 0;
      } else if (type === "TICK_DONE") {
        const { midPrice, bids, asks, events: tickEvents } = data;
        setMark(midPrice);

        const prev = framesRef.current;
        const last = prev[prev.length - 1];
        const nextEma = last ? last.ind.ema * 0.85 + midPrice * 0.15 : midPrice;
        const drift = midPrice - (last ? last.mark : midPrice);
        const rsi = Math.max(5, Math.min(95, 50 + drift * 800));
        const imb = bookImbalance(bids, asks);
        const vol = Math.abs(drift) / Math.max(1e-6, market.volatility);
        const snap: Snapshot = {
          id: ++frameSeq.current,
          t: Date.now(),
          mark: midPrice,
          bids,
          asks,
          ind: { ema: nextEma, rsi, imb, vol },
        };

        // Glass-box momentum agent: decide → risk-gate → submit (#1, #5).
        const sinceLast = snap.t - lastDecision.current;
        if (sinceLast > 3200 && Math.random() > 0.65) {
          const bullish = imb > 0.08 && midPrice > nextEma && rsi < 70;
          const bearish = imb < -0.08 && midPrice < nextEma && rsi > 30;
          if (bullish || bearish) {
            lastDecision.current = snap.t;
            const side: Side = bullish ? "BUY" : "SELL";
            const edgeFrac = Math.abs(midPrice - nextEma) / (nextEma || 1);
            const conviction = Math.min(0.99, 0.45 + Math.abs(imb) * 1.6 + edgeFrac * 60);
            const qty =
              market.type === "perp"
                ? +(0.05 + conviction * 0.6).toFixed(2)
                : +(20 + conviction * 120).toFixed(0);
            const crossP =
              side === "BUY"
                ? (asks[0]?.px ?? midPrice + market.tick)
                : (bids[0]?.px ?? midPrice - market.tick);
            const expectedPnl = +(crossP * qty * edgeFrac * conviction).toFixed(2);
            const triggers: Trigger[] = [
              {
                label: "Book imbalance",
                value: `${(imb * 100).toFixed(1)}%`,
                pass: bullish ? imb > 0.08 : imb < -0.08,
              },
              {
                label: "Mark vs EMA(20)",
                value: `${(((midPrice - nextEma) / (nextEma || 1)) * 100).toFixed(2)}%`,
                pass: bullish ? midPrice > nextEma : midPrice < nextEma,
              },
              { label: "RSI(14)", value: rsi.toFixed(1), pass: bullish ? rsi < 70 : rsi > 30 },
              { label: "Vol regime", value: vol.toFixed(2), pass: vol < 2.2 },
            ];
            const monologue = bullish
              ? `Bid stack outweighs offers (${(imb * 100).toFixed(1)}% imbalance) while mark sits ${(((midPrice - nextEma) / (nextEma || 1)) * 1e4).toFixed(0)}bps above EMA(20). Lifting ${qty} ${market.symbol} at ${fmtPrice(market, crossP)}.`
              : `Offers dominate (${(imb * 100).toFixed(1)}% imbalance) and mark broke ${(((nextEma - midPrice) / (nextEma || 1)) * 1e4).toFixed(0)}bps under EMA(20). Hitting bid for ${qty} ${market.symbol} at ${fmtPrice(market, crossP)}.`;

            const draft: DecisionDraft = {
              frameId: snap.id,
              side,
              px: crossP,
              qty,
              conviction,
              monologue,
              triggers,
              expectedPnl,
              tif: "GTC",
            };
            const verdict = evaluateRisk(draft, agentBotRef.current, snap.t);
            setLastVerdict(verdict);

            if (agentBotRef.current.paused || !verdict.allow) {
              agentBotRef.current = withBlockedRecorded(agentBotRef.current, snap.t);
              const blocker = verdict.alerts.find((a) => a.severity === "block");
              const blockedEv: TLEvent = {
                frameId: snap.id,
                t: snap.t,
                kind: "blocked",
                side,
                text: `🛡 firewall blocked ${side} ${qty} — ${agentBotRef.current.paused ? "agent paused" : (blocker?.message ?? "risk limit")}`,
                agent: true,
              };
              setTimeline((prevTl) => [blockedEv, ...prevTl].slice(0, TL_CAP));
            } else {
              agentBotRef.current = withSubmissionRecorded(
                agentBotRef.current,
                side,
                snap.id,
                snap.t,
              );
              pendingDecisionRef.current = {
                frameId: snap.id,
                side,
                conviction,
                monologue,
                triggers,
                riskLimit: verdict.riskLimit,
                maxLossUsd: verdict.maxLossUsd,
                leverage: verdict.leverage,
                expectedPnl,
              };
              worker.postMessage({
                type: "SUBMIT_LIMIT",
                data: { side, price: crossP, qty, tif: "GTC", isAgent: true },
              });
            }
          }
        }

        framesRef.current = [...prev, snap].slice(-FRAME_CAP);
        setFrames([...framesRef.current]);

        processEvents(tickEvents, market.symbol, snap.id, false, false);

        // Mark-to-market live agent decisions + refresh agent metrics (#1).
        let touched = false;
        for (const d of decisionsRef.current) {
          if (d._filledQty > 0) {
            d.actualPnl = +(
              d._filledQty * (midPrice - d._fillPx) * (d.side === "BUY" ? 1 : -1) -
              d._fees
            ).toFixed(2);
            touched = true;
          }
        }
        agentBotRef.current = {
          ...agentBotRef.current,
          metrics: recomputeMetrics(agentBotRef.current, midPrice, 0),
        };
        setAgentBot(agentBotRef.current);
        if (touched) flushDecisions();
      } else if (type === "ORDER_EVENT") {
        const fid = framesRef.current[framesRef.current.length - 1]?.id ?? 0;
        processEvents(events, market.symbol, fid, isUser, isAgent);
      } else if (type === "ERROR") {
        console.error("Worker error:", error);
      }
    };

    return () => {
      worker.terminate();
    };
  }, [market, processEvents, flushDecisions]);

  // Tick timer.
  useEffect(() => {
    if (!workerRef.current) return;
    const interval = setInterval(() => {
      workerRef.current?.postMessage({ type: "TICK" });
    }, FRAME_MS);
    return () => clearInterval(interval);
  }, [market]);

  // Time-travel playback: advance the view cursor while playing (#2).
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setViewId((cur) => {
        const list = framesRef.current;
        if (list.length < 2) return cur;
        const lastIdx = list.length - 1;
        const idx = cur === null ? lastIdx : list.findIndex((f) => f.id === cur);
        const nextIdx = idx + 1;
        if (idx === -1 || nextIdx >= lastIdx) {
          setPlaying(false);
          return null; // caught up → live
        }
        return list[nextIdx].id;
      });
    }, FRAME_MS / speed);
    return () => clearInterval(id);
  }, [playing, speed]);

  const handleSubmitOrder = useCallback(
    (side: Side, orderType: Order, price: number, qty: number) => {
      if (orderType === "LIMIT") {
        workerRef.current?.postMessage({
          type: "SUBMIT_LIMIT",
          data: { side, price, qty, tif: "GTC" },
        });
      } else {
        workerRef.current?.postMessage({ type: "SUBMIT_MARKET", data: { side, qty } });
      }
    },
    [],
  );

  const handleCancelOrder = useCallback((orderId: number) => {
    workerRef.current?.postMessage({ type: "CANCEL", data: { orderId } });
  }, []);

  const liveFrame = frames[frames.length - 1];
  const viewFrame =
    viewId === null ? liveFrame : (frames.find((f) => f.id === viewId) ?? liveFrame);
  const isLive = viewId === null;

  const jumpToDecision = useCallback((d: Decision) => {
    setPlaying(false);
    setViewId(d.frameId);
  }, []);

  const stepView = useCallback((dir: -1 | 1) => {
    setPlaying(false);
    setViewId((cur) => {
      const list = framesRef.current;
      if (list.length < 2) return cur;
      const lastIdx = list.length - 1;
      const idx = cur === null ? lastIdx : list.findIndex((f) => f.id === cur);
      const nextIdx = Math.max(0, Math.min(lastIdx, idx + dir));
      return nextIdx >= lastIdx ? null : list[nextIdx].id;
    });
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]);
  }, []);

  const replay = {
    playing,
    speed,
    onTogglePlay: () => setPlaying((p) => !p),
    onStep: stepView,
    onCycleSpeed: cycleSpeed,
  };

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
              replay={replay}
            />
          </PanelErrorBoundary>
          <OrderTicket market={market} mark={mark} onSubmitOrder={handleSubmitOrder} />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <ThoughtStream
            market={market}
            decisions={decisions}
            activeFrameId={viewFrame?.id ?? null}
            onJump={jumpToDecision}
          />
          <PositionsAndOrders
            market={market}
            positions={positions}
            userOrders={userOrders}
            onCancel={handleCancelOrder}
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
          <RiskFirewall
            bot={agentBot}
            mark={mark}
            verdict={lastVerdict}
            onTogglePause={(paused) => {
              agentBotRef.current = { ...agentBotRef.current, paused };
              setAgentBot(agentBotRef.current);
            }}
          />
          <EventTicker
            market={market}
            events={timeline}
            viewFrameId={isLive ? null : (viewFrame?.id ?? null)}
            isLive={isLive}
          />
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
      <span
        className={pos === undefined ? "text-foreground" : pos ? "text-live" : "text-destructive"}
      >
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

type ReplayControls = {
  playing: boolean;
  speed: number;
  onTogglePlay: () => void;
  onStep: (dir: -1 | 1) => void;
  onCycleSpeed: () => void;
};

function ChartPanel({
  market,
  frames,
  viewId,
  onScrub,
  isLive,
  decisions,
  replay,
}: {
  market: MarketConfig;
  frames: Snapshot[];
  viewId: number | null;
  onScrub: (id: number | null) => void;
  isLive: boolean;
  decisions: Decision[];
  replay: ReplayControls;
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

      {/* Time-travel transport controls (#2) */}
      <div className="mt-2 flex items-center gap-1.5 px-1">
        <button
          type="button"
          onClick={() => replay.onStep(-1)}
          className="rounded border border-border p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Step back"
        >
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={replay.onTogglePlay}
          className={`rounded border p-1 ${replay.playing ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
          aria-label={replay.playing ? "Pause replay" : "Play replay"}
        >
          {replay.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => replay.onStep(1)}
          className="rounded border border-border p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Step forward"
        >
          <SkipForward className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={replay.onCycleSpeed}
          className="ml-1 flex items-center gap-1 rounded border border-border px-1.5 py-1 font-mono text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Gauge className="h-3 w-3" /> {replay.speed}×
        </button>
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
          className="ml-2 flex-1"
        />
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {viewFrame ? new Date(viewFrame.t).toLocaleTimeString([], { hour12: false }) : "—"}
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

function OrderTicket({
  market,
  mark,
  onSubmitOrder,
}: {
  market: MarketConfig;
  mark: number;
  onSubmitOrder: (side: Side, orderType: Order, price: number, qty: number) => void;
}) {
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
    onSubmitOrder(side, order, parseFloat(price), parseFloat(qty));
    setSubmitted({ id: `ord_user_${Math.random().toString(36).slice(2, 6)}`, side });
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
            const pnlTone =
              d.actualPnl === null
                ? "text-muted-foreground"
                : d.actualPnl >= 0
                  ? "text-live"
                  : "text-destructive";
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : d.id)}
                  className={`grid w-full grid-cols-[58px_56px_1fr_64px_70px] items-center gap-2 px-1 py-2 text-left tabular-nums transition-colors hover:bg-secondary/50 ${
                    isActive ? "bg-accent/5" : ""
                  }`}
                >
                  <span className={d.side === "BUY" ? "text-live" : "text-destructive"}>
                    {d.side}
                  </span>
                  <span className="text-muted-foreground">{d.qty}</span>
                  <span className="truncate text-foreground/80">{d.monologue}</span>
                  <span className={`text-right ${pnlTone}`}>
                    {d.actualPnl === null
                      ? `~$${d.expectedPnl.toFixed(0)}`
                      : `${d.actualPnl >= 0 ? "+" : ""}$${d.actualPnl.toFixed(0)}`}
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

                    {/* Risk limit + expected vs actual PnL (#1) */}
                    <div className="grid gap-1 sm:grid-cols-2">
                      <div className="flex items-center justify-between rounded border border-border bg-background/60 px-2 py-1 font-mono text-[11px] tabular-nums">
                        <span className="text-muted-foreground">Risk limit used</span>
                        <span className="text-foreground">{d.riskLimit}</span>
                      </div>
                      <div className="flex items-center justify-between rounded border border-border bg-background/60 px-2 py-1 font-mono text-[11px] tabular-nums">
                        <span className="text-muted-foreground">Max loss</span>
                        <span className="text-foreground">${d.maxLossUsd.toFixed(0)}</span>
                      </div>
                      <div className="flex items-center justify-between rounded border border-border bg-background/60 px-2 py-1 font-mono text-[11px] tabular-nums">
                        <span className="text-muted-foreground">Expected PnL</span>
                        <span className="text-foreground">~${d.expectedPnl.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between rounded border border-border bg-background/60 px-2 py-1 font-mono text-[11px] tabular-nums">
                        <span className="text-muted-foreground">Actual PnL ({d.status})</span>
                        <span className={pnlTone}>
                          {d.actualPnl === null
                            ? "—"
                            : `${d.actualPnl >= 0 ? "+" : ""}$${d.actualPnl.toFixed(2)}`}
                        </span>
                      </div>
                    </div>

                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        Triggers ({d.triggers.filter((t) => t.pass).length}/{d.triggers.length}{" "}
                        pass) · conviction {(d.conviction * 100).toFixed(0)}%
                      </p>
                      <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                        {d.triggers.map((t) => (
                          <li
                            key={t.label}
                            className="flex items-center justify-between rounded border border-border bg-background/60 px-2 py-1 font-mono text-[11px] tabular-nums"
                          >
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <span className={t.pass ? "text-live" : "text-destructive"}>
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

const TL_COLOR: Record<TLEvent["kind"], string> = {
  accepted: "text-muted-foreground",
  trade: "text-accent",
  filled: "text-live",
  cancelled: "text-yellow-400",
  blocked: "text-destructive",
};

function EventTicker({
  market,
  events,
  viewFrameId,
  isLive,
}: {
  market: MarketConfig;
  events: TLEvent[];
  viewFrameId: number | null;
  isLive: boolean;
}) {
  const shown = isLive ? events.slice(0, 40) : events.filter((e) => e.frameId === viewFrameId);

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center justify-between px-1">
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Event ticker {market.symbol}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {isLive ? "live tape" : `frame snapshot · ${shown.length} events`}
        </p>
      </div>
      <div className="mt-2 h-48 overflow-y-auto font-mono text-[11px] leading-relaxed">
        {shown.length === 0 ? (
          <p className="mt-6 text-center text-muted-foreground">
            {isLive ? "waiting for order flow…" : "no events at this frame"}
          </p>
        ) : (
          shown.map((e, i) => (
            <div
              key={`${e.frameId}-${i}`}
              className={`flex items-center gap-2 ${TL_COLOR[e.kind]}`}
            >
              <span className="text-muted-foreground/60">
                {new Date(e.t).toLocaleTimeString([], { hour12: false })}
              </span>
              {e.agent && (
                <span className="rounded bg-accent/15 px-1 text-[9px] uppercase tracking-wide text-accent">
                  agent
                </span>
              )}
              <span className="truncate">{e.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PositionsAndOrders({
  market,
  positions,
  userOrders,
  onCancel,
}: {
  market: MarketConfig;
  positions: Record<string, { side: Side | null; size: number; entry: number }>;
  userOrders: Record<
    number,
    { id: number; side: Side; price: number; qty: number; remaining: number }
  >;
  onCancel: (orderId: number) => void;
}) {
  const [tab, setTab] = useState<"positions" | "orders">("positions");

  const posList = Object.entries(positions).filter(([_, pos]) => pos.side !== null);
  const orderList = Object.values(userOrders);

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 flex flex-col h-[280px]">
      <div className="flex border-b border-border font-mono text-[10px] uppercase tracking-wide">
        <button
          onClick={() => setTab("positions")}
          className={`pb-1.5 px-3 -mb-[1px] border-b-2 font-medium ${
            tab === "positions"
              ? "border-accent text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Positions ({posList.length})
        </button>
        <button
          onClick={() => setTab("orders")}
          className={`pb-1.5 px-3 -mb-[1px] border-b-2 font-medium ${
            tab === "orders"
              ? "border-accent text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Open Orders ({orderList.length})
        </button>
      </div>

      {tab === "positions" ? (
        <div className="mt-3 flex-1 overflow-y-auto">
          <div className="grid grid-cols-5 px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground pb-2 border-b border-border/50">
            <span>Market</span>
            <span className="text-right">Side</span>
            <span className="text-right">Size</span>
            <span className="text-right">Entry</span>
            <span className="text-right">PnL</span>
          </div>
          <div className="divide-y divide-border/30 font-mono text-xs tabular-nums">
            {posList.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">No active positions</p>
            ) : (
              posList.map(([symbol, pos]) => {
                const isBull = pos.side === "BUY";
                const mkt = getMarket(symbol);
                const currentMark = symbol === market.symbol ? market.base : mkt.base;
                const pnl = pos.size * (currentMark - pos.entry) * (isBull ? 1 : -1);

                return (
                  <div key={symbol} className="grid grid-cols-5 px-1 py-2 items-center">
                    <span className="font-semibold">{symbol}</span>
                    <span
                      className={`text-right font-medium ${isBull ? "text-live" : "text-destructive"}`}
                    >
                      {isBull ? "LONG" : "SHORT"}
                    </span>
                    <span className="text-right">{pos.size}</span>
                    <span className="text-right">{pos.entry.toLocaleString()}</span>
                    <span
                      className={`text-right font-semibold ${pnl >= 0 ? "text-live" : "text-destructive"}`}
                    >
                      {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex-1 overflow-y-auto">
          <div className="grid grid-cols-5 px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground pb-2 border-b border-border/50">
            <span>Side</span>
            <span className="text-right">Price</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Rem</span>
            <span className="text-right">Action</span>
          </div>
          <div className="divide-y divide-border/30 font-mono text-xs tabular-nums">
            {orderList.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">No open orders</p>
            ) : (
              orderList.map((ord) => {
                const isBuy = ord.side === "BUY";
                return (
                  <div key={ord.id} className="grid grid-cols-5 px-1 py-1.5 items-center">
                    <span className={isBuy ? "text-live" : "text-destructive"}>{ord.side}</span>
                    <span className="text-right">{ord.price.toLocaleString()}</span>
                    <span className="text-right">{ord.qty}</span>
                    <span className="text-right">{ord.remaining}</span>
                    <div className="text-right">
                      <button
                        onClick={() => onCancel(ord.id)}
                        className="rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive hover:bg-destructive/20 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
