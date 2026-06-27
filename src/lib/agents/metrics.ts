/**
 * Pure performance + risk metrics for a bot. The Sharpe / drawdown formulas
 * mirror the server-side analytics endpoint (lib/analytics-api.ts) so the
 * client arena and the server analytics agree on definitions.
 */

import type { BotMetrics, BotState } from "./types";

type PnlPoint = { t: number; pnl: number };

/** Annualized Sharpe over realized-PnL diffs (risk-free rate ignored). */
export function sharpe(pnlHistory: PnlPoint[]): number {
  if (pnlHistory.length <= 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < pnlHistory.length; i++) {
    returns.push(pnlHistory[i].pnl - pnlHistory[i - 1].pnl);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
}

/** Largest peak-to-trough drop in the realized-PnL curve (quote ccy, ≥ 0). */
export function maxDrawdown(pnlHistory: PnlPoint[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const p of pnlHistory) {
    peak = Math.max(peak, p.pnl);
    maxDd = Math.max(maxDd, peak - p.pnl);
  }
  return maxDd;
}

/** Orders submitted inside the firewall's rolling window. */
export function ordersInWindow(state: BotState, now: number = Date.now()): number {
  return state.counters.orderTimestamps.filter((t) => now - t <= state.limits.windowMs).length;
}

/** Composite 0..100 risk score (higher = riskier). */
export function computeRiskScore(state: BotState, mark: number): number {
  const notional = Math.abs(state.position) * mark;
  const levRatio = notional / Math.max(1, state.bankroll) / Math.max(1, state.limits.maxLeverage);
  const ddRatio = maxDrawdown(state.pnlHistory) / Math.max(1, state.limits.maxDrawdownUsd);
  const otRatio = ordersInWindow(state) / Math.max(1, state.limits.maxOrdersPerWindow);
  const ffRatio = state.counters.flipFlops / 5;
  const score =
    35 * Math.min(1, levRatio) +
    35 * Math.min(1, ddRatio) +
    20 * Math.min(1, otRatio) +
    10 * Math.min(1, ffRatio);
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Recompute the full metric block from a bot's current state + mark. */
export function recomputeMetrics(state: BotState, mark: number, avgLatencyMs: number): BotMetrics {
  const realizedPnl = state.pnlHistory[state.pnlHistory.length - 1]?.pnl ?? 0;
  const unrealizedPnl = state.position * (mark - state.entryPrice);
  return {
    realizedPnl,
    unrealizedPnl,
    maxDrawdown: maxDrawdown(state.pnlHistory),
    winRate: state.metrics.trades > 0 ? state.metrics.wins / state.metrics.trades : 0,
    trades: state.metrics.trades,
    wins: state.metrics.wins,
    avgLatencyMs,
    sharpe: sharpe(state.pnlHistory),
    riskScore: computeRiskScore(state, mark),
  };
}
