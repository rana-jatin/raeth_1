/**
 * useArena — client-side runner for the Strategy Arena (#3).
 *
 * Owns ONE matching-engine worker, ticks it, builds a FrameContext each tick,
 * runs every bot's strategy, gates each candidate order through the Risk
 * Firewall (#5), submits the survivors, and attributes the resulting fills back
 * to the originating bot by order id (the same attribution trade.tsx does for a
 * single agent). It maintains per-bot positions, PnL, metrics, a decision log
 * for Glass-Box (#1), and an event timeline for Time-Travel (#2).
 *
 * Working state lives in refs (mutated inside the worker callback) and is
 * flushed to React state once per tick — this keeps the hot path allocation-
 * light while still driving a live dashboard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketConfig } from "@/lib/markets";
import { deriveIndicators } from "./indicators";
import { decide } from "./strategies";
import {
  evaluateRisk,
  withBlockedRecorded,
  withRejectRecorded,
  withSubmissionRecorded,
} from "./risk";
import { recomputeMetrics } from "./metrics";
import { applyFillToBot } from "./accounting";
import { createBotState } from "./presets";
import type {
  BotState,
  Decision,
  DecisionDraft,
  FrameContext,
  RiskVerdict,
  Side,
  Snapshot,
  StrategyKind,
  TimelineEvent,
} from "./types";

const FRAME_MS = 900;
const FRAME_CAP = 240;
const DECISION_CAP = 60;
const TIMELINE_CAP = 200;
const FEE_RATE = 0.0005;

interface DecisionRec extends Decision {
  _filledQty: number;
  _fillPx: number;
  _fees: number;
}

interface WorkerEvent {
  type: "accepted" | "trade" | "cancelled" | "filled" | string;
  id?: number;
  maker_id?: number;
  taker_id?: number;
  side?: Side;
  price?: number;
  qty?: number;
  remaining?: number;
}

export interface UseArenaResult {
  bots: BotState[];
  frames: Snapshot[];
  decisions: Decision[];
  timeline: TimelineEvent[];
  mark: number;
  ready: boolean;
  setPaused: (botId: string, paused: boolean) => void;
  addBot: (kind: StrategyKind, overrides?: Parameters<typeof createBotState>[2]) => string;
  removeBot: (botId: string) => void;
}

export function useArena(market: MarketConfig, initialKinds: StrategyKind[]): UseArenaResult {
  const [bots, setBots] = useState<BotState[]>([]);
  const [frames, setFrames] = useState<Snapshot[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [mark, setMark] = useState(market.base);
  const [ready, setReady] = useState(false);

  // ── Mutable working state (authoritative; flushed to React each tick) ──
  const botsRef = useRef<BotState[]>([]);
  const framesRef = useRef<Snapshot[]>([]);
  const decisionsRef = useRef<DecisionRec[]>([]);
  const decisionMap = useRef<Map<string, DecisionRec>>(new Map());
  const timelineRef = useRef<TimelineEvent[]>([]);
  const markRef = useRef(market.base);

  const orderOwner = useRef<Map<number, string>>(new Map()); // orderId → botId
  const orderDecision = useRef<Map<number, string>>(new Map()); // orderId → decisionId
  const pendingReq = useRef<Map<string, string>>(new Map()); // reqId → decisionId
  const latency = useRef<Map<string, { sum: number; n: number }>>(new Map());

  const workerRef = useRef<Worker | null>(null);
  const frameSeq = useRef(0);
  const decisionSeq = useRef(0);
  const reqSeq = useRef(0);

  const findBot = (id: string) => botsRef.current.find((b) => b.id === id);
  const replaceBot = (next: BotState) => {
    botsRef.current = botsRef.current.map((b) => (b.id === next.id ? next : b));
  };

  const flush = useCallback(() => {
    setBots([...botsRef.current]);
    setFrames([...framesRef.current]);
    setDecisions(decisionsRef.current.map((d) => d as Decision));
    setTimeline([...timelineRef.current]);
    setMark(markRef.current);
  }, []);

  const pushTimeline = (ev: TimelineEvent) => {
    timelineRef.current = [ev, ...timelineRef.current].slice(0, TIMELINE_CAP);
  };

  // ── PnL / position accounting ──────────────────────────────────────────────

  const reconcileDecision = (orderId: number, price: number, qty: number, now: number) => {
    const decId = orderDecision.current.get(orderId);
    if (!decId) return;
    const dec = decisionMap.current.get(decId);
    if (!dec) return;
    const newQty = dec._filledQty + qty;
    dec._fillPx = newQty > 0 ? (dec._fillPx * dec._filledQty + price * qty) / newQty : price;
    dec._filledQty = newQty;
    dec._fees += price * qty * FEE_RATE;
    dec.status = dec._filledQty >= dec.qty - 1e-9 ? "filled" : "partial";

    // first fill → latency sample
    const lat = latency.current.get(dec.botId) ?? { sum: 0, n: 0 };
    if (dec._filledQty === qty) {
      lat.sum += Math.max(0, now - dec.t);
      lat.n += 1;
      latency.current.set(dec.botId, lat);
    }
  };

  const markToMarket = (dec: DecisionRec, m: number) => {
    if (dec._filledQty <= 0) return;
    const sign = dec.side === "BUY" ? 1 : -1;
    dec.actualPnl = +(dec._filledQty * (m - dec._fillPx) * sign - dec._fees).toFixed(2);
  };

  // ── Event processing (shared by TICK_DONE and ORDER_EVENT) ──────────────────

  const processEvents = (events: WorkerEvent[], frameId: number, now: number) => {
    for (const ev of events) {
      if (ev.type === "trade") {
        const px = ev.price ?? markRef.current;
        const qty = ev.qty ?? 0;
        if (qty <= 0) continue;
        const takerSide = (ev.side ?? "BUY") as Side;

        const makerBotId = ev.maker_id != null ? orderOwner.current.get(ev.maker_id) : undefined;
        const takerBotId = ev.taker_id != null ? orderOwner.current.get(ev.taker_id) : undefined;

        if (makerBotId) {
          const bot = findBot(makerBotId);
          const makerSide: Side = takerSide === "BUY" ? "SELL" : "BUY";
          if (bot) {
            replaceBot(applyFillToBot(bot, makerSide, px, qty).bot);
            reconcileDecision(ev.maker_id!, px, qty, now);
            pushTimeline({
              frameId,
              t: now,
              kind: "trade",
              side: makerSide,
              px,
              qty,
              botId: makerBotId,
              text: `${bot.name} filled ${makerSide} ${qty} @ ${px} (maker)`,
            });
          }
        }
        if (takerBotId) {
          const bot = findBot(takerBotId);
          if (bot) {
            replaceBot(applyFillToBot(bot, takerSide, px, qty).bot);
            reconcileDecision(ev.taker_id!, px, qty, now);
            pushTimeline({
              frameId,
              t: now,
              kind: "trade",
              side: takerSide,
              px,
              qty,
              botId: takerBotId,
              text: `${bot.name} filled ${takerSide} ${qty} @ ${px} (taker)`,
            });
          }
        }
      } else if (ev.type === "cancelled" && ev.id != null) {
        const botId = orderOwner.current.get(ev.id);
        const decId = orderDecision.current.get(ev.id);
        if (decId) {
          const dec = decisionMap.current.get(decId);
          if (dec && dec._filledQty <= 0) {
            dec.status = "expired";
            dec.actualPnl = 0;
          }
        }
        if (botId)
          pushTimeline({
            frameId,
            t: now,
            kind: "cancelled",
            botId,
            text: `order ${ev.id} cancelled (${ev.remaining ?? 0} returned)`,
          });
      }
    }
  };

  // ── Strategy step: decide → risk-gate → submit ──────────────────────────────

  const submit = (
    bot: BotState,
    draft: DecisionDraft,
    verdict: RiskVerdict,
    frameId: number,
    now: number,
  ) => {
    const decId = `dec_${(++decisionSeq.current).toString().padStart(5, "0")}`;
    const dec: DecisionRec = {
      ...draft,
      id: decId,
      botId: bot.id,
      t: now,
      riskLimit: verdict.riskLimit,
      maxLossUsd: verdict.maxLossUsd,
      leverage: verdict.leverage,
      actualPnl: null,
      status: "pending",
      _filledQty: 0,
      _fillPx: 0,
      _fees: 0,
    };
    decisionMap.current.set(decId, dec);
    decisionsRef.current = [dec, ...decisionsRef.current].slice(0, DECISION_CAP);

    const reqId = `${bot.id}:${++reqSeq.current}`;
    pendingReq.current.set(reqId, decId);

    workerRef.current?.postMessage({
      type: "SUBMIT_LIMIT",
      data: {
        side: draft.side,
        price: draft.px,
        qty: draft.qty,
        tif: draft.tif ?? "GTC",
        isAgent: true,
        reqId,
      },
    });
  };

  const runStrategies = (frame: Snapshot, now: number) => {
    const recent = framesRef.current;
    for (let i = 0; i < botsRef.current.length; i++) {
      const bot = botsRef.current[i];
      if (bot.paused) continue;
      if (now - bot.lastDecisionAt < bot.cadenceMs) continue;

      const ctx: FrameContext = { market, frame, recent };
      const draft = decide(bot.kind, ctx, bot);
      if (!draft) continue;

      const verdict = evaluateRisk(draft, bot, now);
      if (!verdict.allow) {
        botsRef.current[i] = withBlockedRecorded(bot, now);
        const blocker = verdict.alerts.find((a) => a.severity === "block");
        pushTimeline({
          frameId: frame.id,
          t: now,
          kind: "cancelled",
          botId: bot.id,
          text: `🛡 firewall blocked ${bot.name}: ${blocker?.message ?? "risk limit"}`,
        });
        continue;
      }
      botsRef.current[i] = withSubmissionRecorded(bot, draft.side, frame.id, now);
      submit(botsRef.current[i], draft, verdict, frame.id, now);
    }
  };

  // ── Worker lifecycle ────────────────────────────────────────────────────────

  useEffect(() => {
    // reset working state for the (re)selected market
    botsRef.current = initialKinds.map((k) => createBotState(k, market));
    framesRef.current = [];
    decisionsRef.current = [];
    decisionMap.current.clear();
    timelineRef.current = [];
    orderOwner.current.clear();
    orderDecision.current.clear();
    pendingReq.current.clear();
    latency.current.clear();
    frameSeq.current = 0;
    markRef.current = market.base;
    setReady(false);
    flush();

    const worker = new Worker(new URL("../../workers/matching.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.postMessage({ type: "INIT" });

    worker.onmessage = (e: MessageEvent) => {
      const { type, data, events, reqId, error } = e.data;

      if (type === "INIT_DONE") {
        worker.postMessage({
          type: "RESET",
          data: { symbol: market.symbol, base: market.base, tick: market.tick, type: market.type },
        });
      } else if (type === "RESET_DONE") {
        setReady(true);
      } else if (type === "TICK_DONE") {
        const now = Date.now();
        const { midPrice, bids, asks, events: tickEvents } = data;
        markRef.current = midPrice;

        const ind = deriveIndicators(market, framesRef.current, midPrice, bids, asks);
        const frame: Snapshot = { id: ++frameSeq.current, t: now, mark: midPrice, bids, asks, ind };
        framesRef.current = [...framesRef.current, frame].slice(-FRAME_CAP);

        processEvents(tickEvents as WorkerEvent[], frame.id, now);
        runStrategies(frame, now);

        // mark-to-market live decisions + recompute metrics
        for (const dec of decisionsRef.current) markToMarket(dec, midPrice);
        for (let i = 0; i < botsRef.current.length; i++) {
          const bot = botsRef.current[i];
          const lat = latency.current.get(bot.id);
          const avgLat = lat && lat.n > 0 ? Math.round(lat.sum / lat.n) : 0;
          bot.metrics = recomputeMetrics(bot, midPrice, avgLat);
        }
        flush();
      } else if (type === "ORDER_EVENT") {
        const now = Date.now();
        const evs = (events as WorkerEvent[]) ?? [];
        const decId = reqId ? pendingReq.current.get(reqId) : undefined;
        const accepted = evs.find((ev) => ev.type === "accepted" && ev.id != null);
        if (decId && accepted && accepted.id != null) {
          const dec = decisionMap.current.get(decId);
          if (dec) {
            dec.orderId = accepted.id;
            orderOwner.current.set(accepted.id, dec.botId);
            orderDecision.current.set(accepted.id, decId);
            pushTimeline({
              frameId: dec.frameId,
              t: now,
              kind: "accepted",
              side: dec.side,
              px: dec.px,
              qty: dec.qty,
              botId: dec.botId,
              text: `order ${accepted.id} accepted: ${dec.side} ${dec.qty} @ ${dec.px}`,
            });
          }
          pendingReq.current.delete(reqId);
        }
        // marketable orders may fill within the same response
        processEvents(evs, framesRef.current[framesRef.current.length - 1]?.id ?? 0, now);
        for (const dec of decisionsRef.current) markToMarket(dec, markRef.current);
        flush();
      } else if (type === "ERROR") {
        console.error("[arena worker]", error);
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market]);

  // ── Tick timer ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => workerRef.current?.postMessage({ type: "TICK" }), FRAME_MS);
    return () => clearInterval(id);
  }, [ready]);

  // ── Imperative controls ─────────────────────────────────────────────────────

  const setPaused = useCallback((botId: string, paused: boolean) => {
    const i = botsRef.current.findIndex((b) => b.id === botId);
    if (i === -1) return;
    botsRef.current[i] = { ...botsRef.current[i], paused };
    setBots([...botsRef.current]);
  }, []);

  const addBot = useCallback(
    (kind: StrategyKind, overrides?: Parameters<typeof createBotState>[2]) => {
      const bot = createBotState(kind, market, overrides);
      botsRef.current = [...botsRef.current, bot];
      setBots([...botsRef.current]);
      return bot.id;
    },
    [market],
  );

  const removeBot = useCallback((botId: string) => {
    botsRef.current = botsRef.current.filter((b) => b.id !== botId);
    for (const [oid, owner] of orderOwner.current)
      if (owner === botId) orderOwner.current.delete(oid);
    setBots([...botsRef.current]);
  }, []);

  return { bots, frames, decisions, timeline, mark, ready, setPaused, addBot, removeBot };
}
