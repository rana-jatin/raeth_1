import { useEffect, useState } from "react";

export type MarketType = "perp" | "binary" | "parlay";

export type MarketConfig = {
  symbol: string;
  name: string;
  kind: string;
  type: MarketType;
  /** Starting mark price. Perps are in USD, binaries/parlays are 0..1 probabilities. */
  base: number;
  /** Decimals used when formatting the mark. */
  decimals: number;
  /** Price granularity used to build order-book ladders. */
  tick: number;
  /** Per-tick random step magnitude for the simulated feed. */
  volatility: number;
  /** 24h change shown on the markets table + ribbon. */
  change: string;
  up: boolean;
  vol: string;
  /** Settlement window label for binaries/parlays. */
  window?: string;
};

export const MARKETS: MarketConfig[] = [
  {
    symbol: "BTC-PERP",
    name: "BTC Perpetual",
    kind: "Linear perp · hourly funding",
    type: "perp",
    base: 64931,
    decimals: 1,
    tick: 1.5,
    volatility: 12,
    change: "+0.37%",
    up: true,
    vol: "$4.21m",
  },
  {
    symbol: "BTC-UPDOWN",
    name: "BTC Up/Down",
    kind: "5-minute binary",
    type: "binary",
    base: 0.55,
    decimals: 3,
    tick: 0.005,
    volatility: 0.01,
    change: "+2.4%",
    up: true,
    vol: "$182.4k",
    window: "5m",
  },
  {
    symbol: "BTC-UPDOWN-15",
    name: "BTC Up/Down (15m)",
    kind: "15-minute binary",
    type: "binary",
    base: 0.48,
    decimals: 3,
    tick: 0.005,
    volatility: 0.008,
    change: "-1.1%",
    up: false,
    vol: "$96.7k",
    window: "15m",
  },
  {
    symbol: "BTC-PARLAY",
    name: "BTC Parlay 3-leg",
    kind: "Multi-window parlay",
    type: "parlay",
    base: 0.21,
    decimals: 3,
    tick: 0.005,
    volatility: 0.012,
    change: "+5.8%",
    up: true,
    vol: "$33.9k",
    window: "3-leg",
  },
];

export const DEFAULT_SYMBOL = "BTC-PERP";

export function getMarket(symbol: string | undefined): MarketConfig {
  return MARKETS.find((m) => m.symbol === symbol) ?? MARKETS[0];
}

export function normalizeSymbol(symbol: unknown): string {
  return typeof symbol === "string" && MARKETS.some((m) => m.symbol === symbol)
    ? symbol
    : DEFAULT_SYMBOL;
}

/** Format a price using the market's conventions (thousands separators for perps). */
export function fmtPrice(market: MarketConfig, value: number): string {
  if (market.type === "perp") {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: market.decimals,
      maximumFractionDigits: market.decimals,
    });
  }
  return value.toFixed(market.decimals);
}

function clampPrice(market: MarketConfig, value: number): number {
  if (market.type === "perp") return value;
  return Math.min(0.98, Math.max(0.02, value));
}

/** Simulated live mark price that resets whenever the selected market changes. */
export function useLiveMark(market: MarketConfig): number {
  const [mark, setMark] = useState(market.base);

  useEffect(() => {
    setMark(market.base);
    const id = setInterval(() => {
      setMark((prev) => clampPrice(market, prev + (Math.random() - 0.5) * market.volatility));
    }, 1200);
    return () => clearInterval(id);
  }, [market]);

  return mark;
}
