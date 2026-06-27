import { describe, it, expect } from "vitest";
import { MARKETS } from "@/lib/markets";
import { createBotState } from "./presets";
import { decide } from "./strategies";
import { evaluateRisk, withSubmissionRecorded, withRejectRecorded, behavioralAlerts } from "./risk";
import { applyFillToBot } from "./accounting";
import { sharpe, maxDrawdown, computeRiskScore } from "./metrics";
import { deriveIndicators } from "./indicators";
import type { DecisionDraft, FrameContext, Indicators, Snapshot } from "./types";

const PERP = MARKETS.find((m) => m.symbol === "BTC-PERP")!;

function frame(id: number, mark: number, ind: Partial<Indicators>): Snapshot {
  return {
    id,
    t: id * 1000,
    mark,
    bids: [{ px: mark - PERP.tick, qty: 5 }],
    asks: [{ px: mark + PERP.tick, qty: 1 }],
    ind: { ema: mark, rsi: 50, imb: 0, vol: 1, micro: 0, ...ind },
  };
}

function ctx(f: Snapshot, recent: Snapshot[] = []): FrameContext {
  return { market: PERP, frame: f, recent };
}

describe("indicators", () => {
  it("returns ema = mark with no history", () => {
    const ind = deriveIndicators(PERP, [], 100, [{ px: 99, qty: 1 }], [{ px: 101, qty: 1 }]);
    expect(ind.ema).toBe(100);
  });
});

describe("strategies", () => {
  it("momentum goes BUY on a bullish frame", () => {
    const f = frame(1, 101, { ema: 100, rsi: 55, imb: 0.2 });
    const d = decide("momentum", ctx(f), createBotState("momentum", PERP));
    expect(d?.side).toBe("BUY");
    expect(d!.qty).toBeGreaterThan(0);
    expect(d!.triggers).toHaveLength(4);
    expect(d!.expectedPnl).toBeGreaterThanOrEqual(0);
  });

  it("momentum stays out with no edge", () => {
    const f = frame(1, 100, { ema: 100, rsi: 50, imb: 0 });
    expect(decide("momentum", ctx(f), createBotState("momentum", PERP))).toBeNull();
  });

  it("mean reversion SELLs an overbought stretch", () => {
    const f = frame(1, 101, { ema: 100, rsi: 75, imb: 0 });
    const d = decide("mean_reversion", ctx(f), createBotState("mean_reversion", PERP));
    expect(d?.side).toBe("SELL");
  });

  it("arbitrage trades a microprice gap", () => {
    const f = frame(1, 101, { micro: 1 });
    const d = decide("arbitrage", ctx(f), createBotState("arbitrage", PERP));
    expect(d?.side).toBe("BUY");
  });

  it("market maker quotes passively (GTC)", () => {
    const f = frame(1, 100, { imb: -0.1 });
    const d = decide("market_maker", ctx(f), createBotState("market_maker", PERP));
    expect(d).not.toBeNull();
    expect(d!.tif).toBe("GTC");
  });

  it("news-reactive jumps on a vol spike with drift", () => {
    const prev = frame(1, 100, {});
    const cur = frame(3, 101, { vol: 2.2 });
    const d = decide(
      "news_reactive",
      ctx(cur, [prev, frame(2, 100.5, {})]),
      createBotState("news_reactive", PERP),
    );
    expect(d?.side).toBe("BUY");
  });
});

describe("risk firewall", () => {
  const draft = (qty: number): DecisionDraft => ({
    frameId: 1,
    side: "BUY",
    px: PERP.base,
    qty,
    conviction: 0.7,
    monologue: "",
    triggers: [],
    expectedPnl: 0,
  });

  it("allows a normal order", () => {
    const v = evaluateRisk(draft(0.3), createBotState("momentum", PERP));
    expect(v.allow).toBe(true);
  });

  it("blocks a paused agent", () => {
    const bot = { ...createBotState("momentum", PERP), paused: true };
    expect(evaluateRisk(draft(0.3), bot).allow).toBe(false);
  });

  it("blocks overtrading", () => {
    const now = 10_000;
    const base = createBotState("momentum", PERP);
    const bot = {
      ...base,
      counters: {
        ...base.counters,
        orderTimestamps: Array.from({ length: base.limits.maxOrdersPerWindow }, () => now),
      },
    };
    const v = evaluateRisk(draft(0.1), bot, now);
    expect(v.allow).toBe(false);
    expect(v.alerts.some((a) => a.kind === "overtrading")).toBe(true);
  });

  it("records submissions and detects flip-flops", () => {
    const bot = withRejectRecorded(createBotState("momentum", PERP));
    expect(bot.counters.consecutiveRejects).toBe(1);
    const s1 = withSubmissionRecorded(bot, "BUY", 1, 1000);
    expect(s1.counters.consecutiveRejects).toBe(0);
    expect(s1.counters.orderTimestamps).toHaveLength(1);
    const s2 = withSubmissionRecorded(s1, "SELL", 2, 1000);
    expect(s2.counters.flipFlops).toBe(1);
  });

  it("surfaces behavioral alerts from drawdown", () => {
    const base = createBotState("momentum", PERP);
    const bot = {
      ...base,
      pnlHistory: [
        { t: 0, pnl: 0 },
        { t: 1, pnl: -base.limits.maxDrawdownUsd - 1 },
      ],
    };
    expect(behavioralAlerts(bot).some((a) => a.kind === "max_loss" && a.severity === "block")).toBe(
      true,
    );
  });
});

describe("accounting", () => {
  it("opens, averages, and realizes PnL on reduce", () => {
    const bot0 = createBotState("momentum", PERP);
    const r1 = applyFillToBot(bot0, "BUY", 100, 1);
    expect(r1.bot.position).toBe(1);
    expect(r1.bot.entryPrice).toBe(100);

    const r2 = applyFillToBot(r1.bot, "BUY", 102, 1);
    expect(r2.bot.position).toBe(2);
    expect(r2.bot.entryPrice).toBeCloseTo(101, 6);

    const r3 = applyFillToBot(r2.bot, "SELL", 110, 1);
    expect(r3.reduced).toBe(true);
    expect(r3.realizedDelta).toBeCloseTo(9, 6);
    expect(r3.bot.position).toBe(1);
    expect(r3.bot.metrics.trades).toBe(1);
    expect(r3.bot.metrics.wins).toBe(1);
  });
});

describe("metrics", () => {
  it("computes drawdown as worst peak-to-trough", () => {
    expect(
      maxDrawdown([
        { t: 0, pnl: 0 },
        { t: 1, pnl: 5 },
        { t: 2, pnl: 2 },
        { t: 3, pnl: 8 },
        { t: 4, pnl: 3 },
      ]),
    ).toBe(5);
  });

  it("sharpe is finite for a rising curve", () => {
    const s = sharpe([
      { t: 0, pnl: 0 },
      { t: 1, pnl: 1 },
      { t: 2, pnl: 2 },
      { t: 3, pnl: 3 },
    ]);
    expect(Number.isFinite(s)).toBe(true);
  });

  it("risk score stays within 0..100", () => {
    const bot = createBotState("momentum", PERP);
    const score = computeRiskScore({ ...bot, position: 0.5 }, PERP.base);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
