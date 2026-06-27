/**
 * Shared agent-core types.
 *
 * One type set powers all five glass-box features: the trade terminal, the
 * Strategy Arena, the Risk Firewall, Natural-Language Trading, and Time-Travel
 * replay. Everything is client-side and simulated — bots are heuristic JS
 * strategies submitting into the same WASM order book the terminal already uses.
 */

import type { MarketConfig } from "@/lib/markets";

export type Side = "BUY" | "SELL";

export type StrategyKind =
  | "momentum"
  | "mean_reversion"
  | "market_maker"
  | "news_reactive"
  | "arbitrage";

/** Indicator readouts an agent saw at a single instant. */
export interface Indicators {
  /** EMA(20)-style smoothed mark. */
  ema: number;
  /** RSI(14)-style oscillator, 0..100. */
  rsi: number;
  /** Order-book imbalance, -1..1 (bid-heavy positive). */
  imb: number;
  /** Volatility regime, ~0..N (1 = typical). */
  vol: number;
  /** Microprice − mid, in price units (microstructure pressure). */
  micro: number;
}

export interface BookLevel {
  px: number;
  qty: number;
}

/** A single recorded instant of the market the agents trade against. */
export interface Snapshot {
  id: number;
  t: number;
  mark: number;
  bids: BookLevel[];
  asks: BookLevel[];
  ind: Indicators;
}

/** A discrete order-book event captured for time-travel replay. */
export interface TimelineEvent {
  frameId: number;
  t: number;
  kind: "accepted" | "trade" | "cancelled" | "filled" | "settlement";
  text: string;
  side?: Side;
  px?: number;
  qty?: number;
  botId?: string;
}

export interface Trigger {
  label: string;
  value: string;
  pass: boolean;
}

export type DecisionStatus = "pending" | "filled" | "partial" | "expired";

/** A draft decision produced by a strategy, before risk gating / submission. */
export interface DecisionDraft {
  frameId: number;
  side: Side;
  px: number;
  qty: number;
  /** Conviction / confidence score 0..1. */
  conviction: number;
  monologue: string;
  triggers: Trigger[];
  /** Heuristic expected PnL in quote currency at decision time. */
  expectedPnl: number;
  /** GTC rests on the book; IOC crosses now or cancels. */
  tif?: "GTC" | "IOC";
}

/** A decision after risk gating, carried through its full lifecycle. */
export interface Decision extends DecisionDraft {
  id: string;
  botId: string;
  t: number;
  /** Human-readable risk envelope applied, e.g. "≤2% bankroll · 5×". */
  riskLimit: string;
  maxLossUsd: number;
  leverage: number;
  /** Realized PnL once the originating order fills/settles; null while pending. */
  actualPnl: number | null;
  status: DecisionStatus;
  orderId?: number;
}

export interface RiskLimits {
  /** Max fraction of bankroll riskable on a single decision (0..1). */
  riskPct: number;
  maxLeverage: number;
  /** Max orders allowed per rolling window. */
  maxOrdersPerWindow: number;
  windowMs: number;
  /** Consecutive engine rejects before the firewall trips. */
  maxConsecutiveRejects: number;
  /** Max drawdown (quote ccy) before the firewall trips. */
  maxDrawdownUsd: number;
}

export type RiskAlertKind =
  | "overtrading"
  | "repeated_failures"
  | "max_loss"
  | "leverage"
  | "suspicious";

export interface RiskAlert {
  kind: RiskAlertKind;
  severity: "info" | "warn" | "block";
  message: string;
}

export interface RiskVerdict {
  allow: boolean;
  notional: number;
  maxLossUsd: number;
  leverage: number;
  /** Human-readable risk envelope, e.g. "≤2% bankroll · 5×". */
  riskLimit: string;
  alerts: RiskAlert[];
}

export interface BotMetrics {
  realizedPnl: number;
  unrealizedPnl: number;
  maxDrawdown: number;
  winRate: number;
  trades: number;
  wins: number;
  avgLatencyMs: number;
  sharpe: number;
  /** Composite 0..100, higher = riskier. */
  riskScore: number;
}

/** Per-bot rolling counters used by the risk firewall. */
export interface RiskCounters {
  /** Submission timestamps inside the overtrading window. */
  orderTimestamps: number[];
  consecutiveRejects: number;
  /** Orders blocked by the firewall (never sent). */
  blockedCount: number;
  /** Highest equity seen, for drawdown. */
  peakEquity: number;
  lastSide: Side | null;
  lastSideFrame: number;
  /** Direction reversals within a short lookback (suspicious churn). */
  flipFlops: number;
}

export interface BotState {
  id: string;
  name: string;
  kind: StrategyKind;
  walletId: string;
  bankroll: number;
  available: number;
  /** Net signed position size in the active market (+long / −short). */
  position: number;
  entryPrice: number;
  paused: boolean;
  limits: RiskLimits;
  metrics: BotMetrics;
  counters: RiskCounters;
  /** Realized-PnL samples over time, for sparkline + Sharpe. */
  pnlHistory: { t: number; pnl: number }[];
  lastDecisionAt: number;
  /** Decision cadence in ms — strategies don't fire every tick. */
  cadenceMs: number;
}

/** Everything a strategy needs to decide at the current frame. */
export interface FrameContext {
  market: MarketConfig;
  frame: Snapshot;
  /** Recent frames, oldest→newest, for lookback signals. */
  recent: Snapshot[];
  /** Cross-market latest snapshots for arbitrage strategies. */
  others?: Record<string, Snapshot | undefined>;
}
