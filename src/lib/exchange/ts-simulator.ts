/**
 * TypeScript market simulator — mirrors the Rust WASM engine's logic on the
 * server side, producing real simulated order-book state.
 *
 * The simulator ticks on a setInterval, walking mid prices and generating
 * synthetic background order flow (market-maker style, same logic as mm.rs).
 * All state is written to server-state.ts so MCP tools can read it live.
 */

import {
  MARKET_CONFIG,
  type MarketSnapshot,
  type MarketSymbol,
  type OrderRecord,
  type FillRecord,
  getAllMarketSnapshots,
  getMarketSnapshot,
  getRestingOrders,
  nextOrderId,
  nextFillId,
  recordFill,
  updateMarketSnapshot,
  updateWallet,
  upsertOrder,
  getWallet,
  getDefaultWalletId,
  getExchangeStore,
} from "@/lib/exchange/server-state";

// ── SplitMix64 PRNG (same as wasm.rs) ────────────────────────────────────────

class Rng {
  private state: bigint;
  constructor(seed: bigint) { this.state = seed; }

  next(): number {
    this.state = BigInt.asUintN(64, this.state + BigInt("0x9E3779B97F4A7C15"));
    let z = this.state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * BigInt("0xBF58476D1CE4E5B9"));
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * BigInt("0x94D049BB133111EB"));
    z = z ^ (z >> 31n);
    return Number(z) / Number(0xFFFF_FFFF_FFFF_FFFFn);
  }

  /** Uniform float in [lo, hi) */
  uniform(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  /** Signed random walk step of magnitude `mag` */
  step(mag: number): number {
    return (this.next() - 0.5) * 2 * mag;
  }
}

// ── Mid-price state ───────────────────────────────────────────────────────────

const midPrices = new Map<MarketSymbol, number>();
const rngs      = new Map<MarketSymbol, Rng>();
let   windowMs  = new Map<MarketSymbol, number>(); // remaining ms for binary windows

function init() {
  for (const [symbol, cfg] of Object.entries(MARKET_CONFIG) as [MarketSymbol, typeof MARKET_CONFIG[MarketSymbol]][]) {
    midPrices.set(symbol, cfg.base);
    rngs.set(symbol, new Rng(BigInt(Math.floor(Math.random() * 1e15))));
    if (cfg.type === "binary" || cfg.type === "parlay") {
      windowMs.set(symbol, cfg.type === "binary" && symbol === "BTC-UPDOWN-15" ? 900_000 : 300_000);
    }
  }
}

// ── Book builder ──────────────────────────────────────────────────────────────

function buildBook(mid: number, tick: number, rng: Rng, levels = 10) {
  const bids: { price: number; qty: number }[] = [];
  const asks: { price: number; qty: number }[] = [];

  for (let i = 1; i <= levels; i++) {
    bids.push({
      price: parseFloat((mid - i * tick).toFixed(5)),
      qty:   parseFloat((rng.uniform(0.2, 4.5)).toFixed(2)),
    });
    asks.push({
      price: parseFloat((mid + i * tick).toFixed(5)),
      qty:   parseFloat((rng.uniform(0.2, 4.5)).toFixed(2)),
    });
  }
  return { bids, asks };
}

// ── Resting-order fill check ──────────────────────────────────────────────────

function processRestingFills(symbol: MarketSymbol, newMid: number) {
  getExchangeStore().fillRestingOrdersAtMid(symbol, newMid);
}

// ── Binary window settlement ──────────────────────────────────────────────────

function settleBinaryWindow(symbol: MarketSymbol) {
  const prev = midPrices.get(symbol) ?? MARKET_CONFIG[symbol].base;
  const rng  = rngs.get(symbol)!;
  const cfg  = MARKET_CONFIG[symbol];

  // Determine outcome
  const newMid = clampMid(symbol, prev + rng.step(cfg.volatility * 3));
  const outcome: "UP" | "DOWN" = newMid > prev ? "UP" : "DOWN";

  getExchangeStore().settleBinaryMarket(symbol, outcome);

  return { newMid, outcome };
}

function clampMid(symbol: MarketSymbol, val: number): number {
  const cfg = MARKET_CONFIG[symbol];
  if (cfg.type === "perp") return Math.max(1000, val);
  return Math.min(0.98, Math.max(0.02, val));
}

// ── Main tick ─────────────────────────────────────────────────────────────────

const TICK_MS   = 2_000; // tick every 2 seconds
const WINDOW_5M = 5 * 60 * 1000;
const WINDOW_15M = 15 * 60 * 1000;

function tick() {
  const now = Date.now();

  for (const [symbol, cfg] of Object.entries(MARKET_CONFIG) as [MarketSymbol, typeof MARKET_CONFIG[MarketSymbol]][]) {
    const prev = midPrices.get(symbol) ?? cfg.base;
    const rng  = rngs.get(symbol)!;

    let newMid = clampMid(symbol, prev + rng.step(cfg.volatility));

    // Binary window countdown
    if (cfg.type === "binary" || cfg.type === "parlay") {
      const windowTarget = symbol === "BTC-UPDOWN-15" || symbol === "BTC-PARLAY" ? WINDOW_15M : WINDOW_5M;
      const rem = (windowMs.get(symbol) ?? windowTarget) - TICK_MS;

      if (rem <= 0) {
        // Settle and reset window
        const result = settleBinaryWindow(symbol);
        newMid = result.newMid;
        windowMs.set(symbol, windowTarget);
      } else {
        windowMs.set(symbol, rem);
      }
    }

    midPrices.set(symbol, newMid);

    // Check if any resting orders got crossed
    processRestingFills(symbol, newMid);

    // Update market snapshot
    const { bids, asks } = buildBook(newMid, cfg.tick, rng, 10);
    const prevSnap = getMarketSnapshot(symbol);
    const prevMid  = prevSnap?.mid ?? cfg.base;

    const snap: MarketSnapshot = {
      symbol,
      mid:    newMid,
      bids,
      asks,
      spread: cfg.tick * 2,
      vol_24h: (prevSnap?.vol_24h ?? 100_000) + rng.uniform(0, 50),
      change_24h: ((newMid - cfg.base) / cfg.base) * 100,
      ...(cfg.type === "perp" ? { funding_rate: parseFloat((rng.uniform(-0.002, 0.002)).toFixed(5)) } : {}),
      ...((cfg.type === "binary" || cfg.type === "parlay") ? { window_remaining_ms: windowMs.get(symbol) } : {}),
    };

    updateMarketSnapshot(snap);
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let _intervalId: ReturnType<typeof setInterval> | null = null;

export function startSimulator() {
  if (_intervalId) return; // already running
  init();
  _intervalId = setInterval(tick, TICK_MS);
  console.log("[raeth simulator] started — ticking every", TICK_MS, "ms");
  startMockAgent();
}

let _mockAgentIntervalId: ReturnType<typeof setInterval> | null = null;

function startMockAgent() {
  if (_mockAgentIntervalId) return;
  _mockAgentIntervalId = setInterval(() => {
    const markets: import("./server-state").MarketSymbol[] = ["BTC-PERP", "BTC-UPDOWN", "BTC-UPDOWN-15"];
    const market = markets[Math.floor(Math.random() * markets.length)];
    const snap = getMarketSnapshot(market);
    if (!snap) return;

    const isBinary = market.includes("UPDOWN") || market === "BTC-PARLAY";
    const side = isBinary 
      ? (Math.random() > 0.5 ? "UP" : "DOWN")
      : (Math.random() > 0.5 ? "BUY" : "SELL");
      
    const isIOC = Math.random() > 0.6;
    
    // Generate price near the mid
    const spreadOffset = isBinary ? 0.01 : 5;
    const price = side === "BUY" || side === "UP"
      ? snap.mid - (Math.random() * spreadOffset * 2) // Might be crossable, might be resting
      : snap.mid + (Math.random() * spreadOffset * 2);

    submitOrderToSimulator({
      market,
      side: side as "BUY" | "SELL" | "UP" | "DOWN",
      price: parseFloat(price.toFixed(isBinary ? 4 : 1)),
      qty: isBinary ? 100 : 0.1,
      tif: isIOC ? "IOC" : "GTC",
    });
  }, 3000); // 1 trade every 3 seconds
}

export function stopSimulator() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
  if (_mockAgentIntervalId) { clearInterval(_mockAgentIntervalId); _mockAgentIntervalId = null; }
}

/** Submit an order from a user or agent into the server-side simulated book. */
export function submitOrderToSimulator(params: {
  market:  MarketSymbol;
  side:    "BUY" | "SELL" | "UP" | "DOWN";
  price:   number;
  qty:     number;
  tif:     "GTC" | "IOC";
}): OrderRecord {
  return getExchangeStore().submitOrder(params);
}
