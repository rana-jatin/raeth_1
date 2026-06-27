/** Shared indicator math used by the trade terminal and the arena runner. */

import type { BookLevel, Indicators, Snapshot } from "./types";
import type { MarketConfig } from "@/lib/markets";

/** Order-book imbalance in [-1, 1]; positive = bid-heavy. */
export function bookImbalance(bids: BookLevel[], asks: BookLevel[]): number {
  const bq = bids.reduce((s, r) => s + r.qty, 0);
  const aq = asks.reduce((s, r) => s + r.qty, 0);
  const total = bq + aq || 1;
  return (bq - aq) / total;
}

/** Size-weighted microprice − mid (microstructure pressure, price units). */
export function micropriceGap(bids: BookLevel[], asks: BookLevel[], mid: number): number {
  const bb = bids[0];
  const ba = asks[0];
  if (!bb || !ba) return 0;
  const denom = bb.qty + ba.qty || 1;
  const micro = (bb.px * ba.qty + ba.px * bb.qty) / denom;
  return micro - mid;
}

/** Derive the indicator block for a new mark from the previous frame. */
export function deriveIndicators(
  market: MarketConfig,
  recent: Snapshot[],
  mark: number,
  bids: BookLevel[],
  asks: BookLevel[],
): Indicators {
  const prev = recent[recent.length - 1];
  const prevMark = prev ? prev.mark : mark;
  const ema = prev ? prev.ind.ema * 0.85 + mark * 0.15 : mark;
  const drift = mark - prevMark;
  const rsi = Math.max(5, Math.min(95, 50 + drift * 800));
  const imb = bookImbalance(bids, asks);
  const vol = Math.abs(drift) / Math.max(1e-6, market.volatility);
  const micro = micropriceGap(bids, asks, mark);
  return { ema, rsi, imb, vol, micro };
}
