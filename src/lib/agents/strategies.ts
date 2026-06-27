/**
 * The five glass-box strategies (#3). Each `decide` is a pure function of the
 * current frame + bot state, returning a `DecisionDraft` (with an explainable
 * monologue + triggers) or null. Decision cadence/throttling is handled by the
 * runner; these functions only encode the signal logic.
 *
 * Everything trades in BUY/SELL terms because the client WASM book is a plain
 * CLOB — for binary markets BUY ≈ UP and SELL ≈ DOWN.
 */

import type { DecisionDraft, FrameContext, BotState, Side, StrategyKind, Trigger } from "./types";
import { fmtPrice } from "@/lib/markets";

function sizeFor(ctx: FrameContext, conviction: number): number {
  return ctx.market.type === "perp"
    ? +(0.05 + conviction * 0.6).toFixed(2)
    : +(20 + conviction * 120).toFixed(0);
}

function bestBidAsk(ctx: FrameContext): { bid: number; ask: number } {
  const { frame, market } = ctx;
  return {
    bid: frame.bids[0]?.px ?? frame.mark - market.tick,
    ask: frame.asks[0]?.px ?? frame.mark + market.tick,
  };
}

/** Marketable price that crosses the spread so the order actually fills. */
function crossPx(ctx: FrameContext, side: Side): number {
  const { bid, ask } = bestBidAsk(ctx);
  return side === "BUY" ? ask : bid;
}

function mk(
  ctx: FrameContext,
  opts: {
    side: Side;
    px: number;
    qty: number;
    conviction: number;
    edgeFrac: number;
    monologue: string;
    triggers: Trigger[];
    tif?: "GTC" | "IOC";
  },
): DecisionDraft {
  const notional = Math.abs(opts.px * opts.qty);
  const expectedPnl = +(notional * Math.abs(opts.edgeFrac) * opts.conviction).toFixed(2);
  return {
    frameId: ctx.frame.id,
    side: opts.side,
    px: opts.px,
    qty: opts.qty,
    conviction: opts.conviction,
    monologue: opts.monologue,
    triggers: opts.triggers,
    expectedPnl,
    tif: opts.tif ?? "GTC",
  };
}

// ── Momentum ──────────────────────────────────────────────────────────────────

function momentum(ctx: FrameContext): DecisionDraft | null {
  const { market, frame } = ctx;
  const { mark } = frame;
  const { imb, ema, rsi, vol } = frame.ind;
  const bullish = imb > 0.08 && mark > ema && rsi < 70;
  const bearish = imb < -0.08 && mark < ema && rsi > 30;
  if (!bullish && !bearish) return null;

  const side: Side = bullish ? "BUY" : "SELL";
  const edgeFrac = Math.abs(mark - ema) / (ema || 1);
  const conviction = Math.min(0.99, 0.45 + Math.abs(imb) * 1.6 + edgeFrac * 60);
  const qty = sizeFor(ctx, conviction);
  const triggers: Trigger[] = [
    {
      label: "Book imbalance",
      value: `${(imb * 100).toFixed(1)}%`,
      pass: bullish ? imb > 0.08 : imb < -0.08,
    },
    {
      label: "Mark vs EMA(20)",
      value: `${(edgeFrac * 100 * (mark >= ema ? 1 : -1)).toFixed(2)}%`,
      pass: bullish ? mark > ema : mark < ema,
    },
    { label: "RSI(14)", value: rsi.toFixed(1), pass: bullish ? rsi < 70 : rsi > 30 },
    { label: "Vol regime", value: vol.toFixed(2), pass: vol < 2.2 },
  ];
  const monologue = bullish
    ? `Bid stack outweighs offers (${(imb * 100).toFixed(1)}% imbalance) while mark sits ${(edgeFrac * 1e4).toFixed(0)}bps above EMA(20). Lifting ${qty} ${market.symbol} at ${fmtPrice(market, mark)}.`
    : `Offers dominate (${(imb * 100).toFixed(1)}% imbalance) and mark broke ${(edgeFrac * 1e4).toFixed(0)}bps under EMA(20). Hitting bid for ${qty} ${market.symbol} at ${fmtPrice(market, mark)}.`;

  return mk(ctx, { side, px: crossPx(ctx, side), qty, conviction, edgeFrac, monologue, triggers });
}

// ── Mean reversion ──────────────────────────────────────────────────────────────

function meanReversion(ctx: FrameContext): DecisionDraft | null {
  const { market, frame } = ctx;
  const { mark } = frame;
  const { ema, rsi, imb, vol } = frame.ind;
  const dev = (mark - ema) / (ema || 1);
  const stretchedUp = rsi > 68 && dev > 0;
  const stretchedDown = rsi < 32 && dev < 0;
  if (!stretchedUp && !stretchedDown) return null;

  const side: Side = stretchedUp ? "SELL" : "BUY";
  const edgeFrac = Math.abs(dev);
  const conviction = Math.min(0.95, 0.4 + edgeFrac * 50 + Math.abs(rsi - 50) / 100);
  const qty = sizeFor(ctx, conviction);
  const triggers: Trigger[] = [
    { label: "RSI(14) extreme", value: rsi.toFixed(1), pass: stretchedUp ? rsi > 68 : rsi < 32 },
    { label: "Dev from EMA", value: `${(dev * 1e4).toFixed(0)}bps`, pass: true },
    {
      label: "Imbalance (fade)",
      value: `${(imb * 100).toFixed(1)}%`,
      pass: stretchedUp ? imb < 0.2 : imb > -0.2,
    },
    { label: "Vol regime", value: vol.toFixed(2), pass: vol < 2.5 },
  ];
  const monologue = stretchedUp
    ? `Mark is ${(dev * 1e4).toFixed(0)}bps over EMA with RSI ${rsi.toFixed(0)} (overbought). Fading the move — selling ${qty} ${market.symbol} back toward the mean.`
    : `Mark is ${(Math.abs(dev) * 1e4).toFixed(0)}bps under EMA with RSI ${rsi.toFixed(0)} (oversold). Buying ${qty} ${market.symbol} for the reversion.`;

  return mk(ctx, { side, px: crossPx(ctx, side), qty, conviction, edgeFrac, monologue, triggers });
}

// ── Market maker ────────────────────────────────────────────────────────────────

function marketMaker(ctx: FrameContext, state: BotState): DecisionDraft | null {
  const { market, frame } = ctx;
  const { imb, vol } = frame.ind;
  // Stand aside in violent regimes — don't get run over.
  if (vol > 2.6) return null;

  const { bid, ask } = bestBidAsk(ctx);
  const inventory = state.position;
  let side: Side;
  if (inventory > 1e-6) side = "SELL";
  else if (inventory < -1e-6) side = "BUY";
  else side = imb >= 0 ? "SELL" : "BUY";

  // Post passively one tick inside the spread (never crossing).
  const raw = side === "BUY" ? bid + market.tick : ask - market.tick;
  const px = side === "BUY" ? Math.min(raw, ask - market.tick) : Math.max(raw, bid + market.tick);
  const conviction = 0.35 + Math.min(0.25, Math.abs(imb) * 0.5);
  const qty = ctx.market.type === "perp" ? 0.08 : 40;
  const spreadFrac = (ask - bid) / (frame.mark || 1);
  const triggers: Trigger[] = [
    { label: "Spread", value: fmtPrice(market, ask - bid), pass: ask - bid >= market.tick },
    {
      label: "Inventory",
      value: inventory.toFixed(market.type === "perp" ? 2 : 0),
      pass: Math.abs(inventory) < 1.5,
    },
    { label: "Imbalance", value: `${(imb * 100).toFixed(1)}%`, pass: true },
    { label: "Vol regime", value: vol.toFixed(2), pass: vol < 2.6 },
  ];
  const monologue =
    inventory === 0
      ? `Flat inventory; quoting the ${side === "SELL" ? "offer" : "bid"} at ${fmtPrice(market, px)} to earn the ${(spreadFrac * 1e4).toFixed(0)}bps spread.`
      : `Inventory ${inventory > 0 ? "long" : "short"} ${Math.abs(inventory).toFixed(market.type === "perp" ? 2 : 0)} — leaning ${side} at ${fmtPrice(market, px)} to mean-revert toward flat.`;

  return mk(ctx, {
    side,
    px,
    qty,
    conviction,
    edgeFrac: spreadFrac,
    monologue,
    triggers,
    tif: "GTC",
  });
}

// ── News-reactive ───────────────────────────────────────────────────────────────

const BULL_HEADLINES = [
  "spot ETF inflows surge",
  "exchange reserves hit multi-year low",
  "large OTC desk lifts offers",
];
const BEAR_HEADLINES = [
  "macro print spooks risk assets",
  "long liquidation cascade prints",
  "miner outflows accelerate",
];

function newsReactive(ctx: FrameContext): DecisionDraft | null {
  const { market, frame, recent } = ctx;
  const { vol, rsi, imb } = frame.ind;
  if (vol <= 1.8) return null; // no "headline"

  const prev = recent[recent.length - 2];
  const drift = prev ? frame.mark - prev.mark : 0;
  if (Math.abs(drift) < 1e-9) return null;

  const side: Side = drift > 0 ? "BUY" : "SELL";
  const headlines = drift > 0 ? BULL_HEADLINES : BEAR_HEADLINES;
  const headline = headlines[frame.id % headlines.length];
  const conviction = Math.min(0.97, 0.6 + (vol - 1.8) * 0.15);
  const edgeFrac = Math.min(0.02, (vol * market.volatility) / (frame.mark || 1));
  const qty = sizeFor(ctx, conviction);
  const triggers: Trigger[] = [
    { label: "Vol spike", value: `${vol.toFixed(1)}×`, pass: vol > 1.8 },
    { label: "Tape direction", value: drift > 0 ? "up" : "down", pass: true },
    { label: "RSI(14)", value: rsi.toFixed(1), pass: side === "BUY" ? rsi < 85 : rsi > 15 },
    {
      label: "Imbalance",
      value: `${(imb * 100).toFixed(1)}%`,
      pass: side === "BUY" ? imb > -0.2 : imb < 0.2,
    },
  ];
  const monologue = `Volatility spiked to ${vol.toFixed(1)}× — treating it as breaking flow ("${headline}"). Reacting ${side} with the tape: ${qty} ${market.symbol}.`;

  return mk(ctx, {
    side,
    px: crossPx(ctx, side),
    qty,
    conviction,
    edgeFrac,
    monologue,
    triggers,
    tif: "IOC",
  });
}

// ── Arbitrage (microprice gap) ────────────────────────────────────────────────

function arbitrage(ctx: FrameContext): DecisionDraft | null {
  const { market, frame } = ctx;
  const { micro, imb, vol } = frame.ind;
  const gapFrac = micro / (frame.mark || 1);
  const band = (market.tick / (frame.mark || 1)) * 0.5;
  if (Math.abs(gapFrac) < band) return null;

  const side: Side = micro > 0 ? "BUY" : "SELL";
  const conviction = Math.min(0.9, 0.5 + Math.abs(gapFrac) * 200);
  const edgeFrac = Math.abs(gapFrac);
  const qty = sizeFor(ctx, conviction);
  const triggers: Trigger[] = [
    {
      label: "Microprice gap",
      value: `${fmtPrice(market, micro)}`,
      pass: Math.abs(gapFrac) >= band,
    },
    {
      label: "Imbalance confirm",
      value: `${(imb * 100).toFixed(1)}%`,
      pass: side === "BUY" ? imb > 0 : imb < 0,
    },
    { label: "Edge", value: `${(gapFrac * 1e4).toFixed(1)}bps`, pass: true },
    { label: "Vol regime", value: vol.toFixed(2), pass: vol < 3 },
  ];
  const monologue = `Microprice sits ${fmtPrice(market, Math.abs(micro))} ${micro > 0 ? "above" : "below"} mid — book is mispriced ${(gapFrac * 1e4).toFixed(1)}bps. Capturing the gap ${side}.`;

  return mk(ctx, {
    side,
    px: crossPx(ctx, side),
    qty,
    conviction,
    edgeFrac,
    monologue,
    triggers,
    tif: "IOC",
  });
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export function decide(
  kind: StrategyKind,
  ctx: FrameContext,
  state: BotState,
): DecisionDraft | null {
  switch (kind) {
    case "momentum":
      return momentum(ctx);
    case "mean_reversion":
      return meanReversion(ctx);
    case "market_maker":
      return marketMaker(ctx, state);
    case "news_reactive":
      return newsReactive(ctx);
    case "arbitrage":
      return arbitrage(ctx);
    default:
      return null;
  }
}
