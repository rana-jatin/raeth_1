/**
 * Pure position + PnL accounting for a bot, shared by the arena runner and the
 * single agent in the trade terminal so both compute PnL identically.
 */

import type { BotState, Side } from "./types";

const FEE_RATE = 0.0005;

export interface FillResult {
  bot: BotState;
  /** Realized PnL crystallized by this fill (position-reducing portion). */
  realizedDelta: number;
  /** True when the fill reduced/closed an existing position. */
  reduced: boolean;
}

/** Apply a fill to a bot, returning a new BotState (immutable). */
export function applyFillToBot(bot: BotState, side: Side, price: number, qty: number): FillResult {
  const signed = side === "BUY" ? qty : -qty;
  const oldPos = bot.position;
  const newPos = +(oldPos + signed).toFixed(8);
  const fee = price * qty * FEE_RATE;
  let realizedDelta = 0;

  const reduced = oldPos !== 0 && Math.sign(oldPos) !== Math.sign(signed);
  if (reduced) {
    const closeQty = Math.min(Math.abs(oldPos), Math.abs(signed));
    realizedDelta = (price - bot.entryPrice) * closeQty * Math.sign(oldPos);
  }

  let entryPrice = bot.entryPrice;
  if (newPos === 0) {
    entryPrice = 0;
  } else if (oldPos === 0 || Math.sign(newPos) === Math.sign(oldPos)) {
    const addQty = Math.abs(signed);
    entryPrice =
      oldPos === 0
        ? price
        : (bot.entryPrice * Math.abs(oldPos) + price * addQty) / (Math.abs(oldPos) + addQty);
  } else {
    entryPrice = price; // flipped through zero — residual opens fresh
  }

  const lastPnl = bot.pnlHistory[bot.pnlHistory.length - 1]?.pnl ?? 0;
  const nextPnl = +(lastPnl + realizedDelta - fee).toFixed(2);

  const nextBot: BotState = {
    ...bot,
    position: newPos,
    entryPrice,
    pnlHistory: [...bot.pnlHistory, { t: Date.now(), pnl: nextPnl }].slice(-200),
    available: Math.max(0, +(bot.bankroll + nextPnl).toFixed(2)),
    metrics: {
      ...bot.metrics,
      trades: bot.metrics.trades + (reduced ? 1 : 0),
      wins: bot.metrics.wins + (reduced && realizedDelta > 0 ? 1 : 0),
    },
  };

  return { bot: nextBot, realizedDelta, reduced };
}
