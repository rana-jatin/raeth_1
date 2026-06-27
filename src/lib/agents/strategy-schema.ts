/**
 * Zod schema for a scoped trading strategy spec (#4).
 *
 * Natural-language input is converted into one of these by the LLM. The spec
 * maps an instruction to the closest built-in strategy plus a bounded risk
 * envelope — it never synthesizes arbitrary executable code, so every armed
 * strategy is a risk-limited instance of a known, inspectable bot.
 */

import { z } from "zod";

export const StrategyKindEnum = z.enum([
  "momentum",
  "mean_reversion",
  "market_maker",
  "news_reactive",
  "arbitrage",
]);

export const MarketEnum = z.enum(["BTC-PERP", "BTC-UPDOWN", "BTC-UPDOWN-15", "BTC-PARLAY"]);

export const StrategySpecSchema = z.object({
  kind: StrategyKindEnum,
  market: MarketEnum,
  side: z.enum(["BUY", "SELL", "AUTO"]).default("AUTO"),
  /** Fraction of bankroll riskable per trade (0.001..0.5). */
  riskPct: z.number().min(0.001).max(0.5),
  maxLeverage: z.number().min(1).max(25),
  entry: z.string().min(1),
  exit: z.string().optional(),
  killSwitch: z.string().optional(),
  name: z.string().optional(),
});

export type StrategySpec = z.infer<typeof StrategySpecSchema>;

export const STRATEGY_KIND_VALUES = StrategyKindEnum.options;
export const MARKET_VALUES = MarketEnum.options;
