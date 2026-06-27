/** Bot presets: per-strategy metadata, default risk limits, and bot factory. */

import type { BotMetrics, BotState, RiskCounters, RiskLimits, StrategyKind } from "./types";
import type { MarketConfig } from "@/lib/markets";

export interface StrategyMeta {
  kind: StrategyKind;
  label: string;
  blurb: string;
  /** Decision cadence in ms — strategies don't fire every tick. */
  cadenceMs: number;
  limits: RiskLimits;
}

const BASE_LIMITS: RiskLimits = {
  riskPct: 0.02,
  maxLeverage: 5,
  maxOrdersPerWindow: 6,
  windowMs: 10_000,
  maxConsecutiveRejects: 4,
  maxDrawdownUsd: 1_500,
};

export const STRATEGY_META: Record<StrategyKind, StrategyMeta> = {
  momentum: {
    kind: "momentum",
    label: "Momentum",
    blurb: "Rides short-window trend when book imbalance and EMA agree.",
    cadenceMs: 3_200,
    limits: { ...BASE_LIMITS, riskPct: 0.03, maxLeverage: 8 },
  },
  mean_reversion: {
    kind: "mean_reversion",
    label: "Mean Reversion",
    blurb: "Fades stretched moves back toward the EMA on RSI extremes.",
    cadenceMs: 3_600,
    limits: { ...BASE_LIMITS, riskPct: 0.02, maxLeverage: 5 },
  },
  market_maker: {
    kind: "market_maker",
    label: "Market Maker",
    blurb: "Quotes inside the spread and manages inventory back to flat.",
    cadenceMs: 1_400,
    limits: { ...BASE_LIMITS, riskPct: 0.015, maxLeverage: 3, maxOrdersPerWindow: 14 },
  },
  news_reactive: {
    kind: "news_reactive",
    label: "News-Reactive",
    blurb: "Jumps on volatility spikes that look like a breaking headline.",
    cadenceMs: 2_600,
    limits: { ...BASE_LIMITS, riskPct: 0.04, maxLeverage: 10, maxConsecutiveRejects: 3 },
  },
  arbitrage: {
    kind: "arbitrage",
    label: "Arbitrage",
    blurb: "Captures microprice gaps when the book is mispriced vs mid.",
    cadenceMs: 1_800,
    limits: { ...BASE_LIMITS, riskPct: 0.025, maxLeverage: 6, maxOrdersPerWindow: 10 },
  },
};

export const STRATEGY_KINDS = Object.keys(STRATEGY_META) as StrategyKind[];

function emptyMetrics(): BotMetrics {
  return {
    realizedPnl: 0,
    unrealizedPnl: 0,
    maxDrawdown: 0,
    winRate: 0,
    trades: 0,
    wins: 0,
    avgLatencyMs: 0,
    sharpe: 0,
    riskScore: 0,
  };
}

function emptyCounters(bankroll: number): RiskCounters {
  return {
    orderTimestamps: [],
    consecutiveRejects: 0,
    blockedCount: 0,
    peakEquity: bankroll,
    lastSide: null,
    lastSideFrame: -1,
    flipFlops: 0,
  };
}

let _seq = 0;
export function nextBotId(): string {
  return `bot_${(++_seq).toString().padStart(3, "0")}`;
}

const STARTING_BANKROLL = 10_000;

export function createBotState(
  kind: StrategyKind,
  _market: MarketConfig,
  overrides?: Partial<Pick<BotState, "name" | "limits" | "bankroll">>,
): BotState {
  const meta = STRATEGY_META[kind];
  const bankroll = overrides?.bankroll ?? STARTING_BANKROLL;
  const id = nextBotId();
  return {
    id,
    name: overrides?.name ?? meta.label,
    kind,
    walletId: `0x${id.replace("bot_", "")}…${kind.slice(0, 3)}`,
    bankroll,
    available: bankroll,
    position: 0,
    entryPrice: 0,
    paused: false,
    limits: overrides?.limits ?? { ...meta.limits },
    metrics: emptyMetrics(),
    counters: emptyCounters(bankroll),
    pnlHistory: [{ t: Date.now(), pnl: 0 }],
    lastDecisionAt: 0,
    cadenceMs: meta.cadenceMs,
  };
}
