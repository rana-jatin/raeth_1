export type MarketSymbol = "BTC-PERP" | "BTC-UPDOWN" | "BTC-UPDOWN-15" | "BTC-PARLAY";
export type OrderSide = "BUY" | "SELL" | "UP" | "DOWN";
export type OrderStatus = "resting" | "filled" | "partially_filled" | "cancelled" | "rejected";
export type TimeInForce = "GTC" | "IOC";

export interface UserAccount {
  user_id: string;
  email?: string;
  wallet_ids: string[];
}

export interface SubWallet {
  wallet_id: string;
  user_id: string;
  label: string;
  created_at: number;
}

export interface ApiKey {
  key_id: string;
  user_id: string;
  wallet_id: string;
  token_prefix: string;
  permissions: Array<"read" | "trade" | "cancel" | "stream" | "mcp">;
  max_order_notional: number;
}

export interface Session {
  session_id: string;
  user_id: string;
  wallet_id: string;
  created_at: number;
  expires_at: number;
}

export interface ScopedRequestContext {
  user_id: string;
  wallet_id: string;
  permissions: ApiKey["permissions"];
  api_key_id?: string;
  session_id?: string;
}

export interface OrderRecord {
  order_id: string;
  wallet_id: string;
  market: MarketSymbol;
  side: OrderSide;
  price: number;
  qty: number;
  filled: number;
  remaining: number;
  status: OrderStatus;
  tif: TimeInForce;
  created_at: number;
  updated_at: number;
}

export interface FillRecord {
  fill_id: string;
  order_id: string;
  wallet_id: string;
  market: MarketSymbol;
  side: OrderSide;
  price: number;
  qty: number;
  fee: number;
  timestamp: number;
}

export interface BookLevel {
  price: number;
  qty: number;
}

export interface MarketSnapshot {
  symbol: MarketSymbol;
  mid: number;
  bids: BookLevel[];
  asks: BookLevel[];
  spread: number;
  vol_24h: number;
  change_24h: number;
  funding_rate?: number;
  window_remaining_ms?: number;
}

export interface WalletBalance {
  wallet_id: string;
  bankroll: number;
  available: number;
  margin_used: number;
  realized_pnl: number;
  total_orders: number;
  cancelled_orders: number;
  filled_orders: number;
  cumulative_latency_ms: number;
  pnl_history: { timestamp: number; pnl: number }[];
}

export interface PositionRecord {
  wallet_id: string;
  market: MarketSymbol;
  side: "LONG" | "SHORT";
  size: number;
  entry_price: number;
  mark_price: number;
  unrealized_pnl: number;
  realized_pnl: number;
  margin: number;
  liquidation_price: number;
}

export type ExchangeEvent =
  | { event_id: string; timestamp: number; type: "MARKET_TICK"; snapshot: MarketSnapshot }
  | { event_id: string; timestamp: number; type: "ORDER_ACCEPTED"; order: OrderRecord }
  | { event_id: string; timestamp: number; type: "ORDER_REJECTED"; order_id: string; reason: string; order?: OrderRecord }
  | { event_id: string; timestamp: number; type: "ORDER_PARTIALLY_FILLED"; order: OrderRecord; fill: FillRecord }
  | { event_id: string; timestamp: number; type: "ORDER_FILLED"; order: OrderRecord; fill?: FillRecord }
  | { event_id: string; timestamp: number; type: "ORDER_CANCELLED"; order: OrderRecord; reason?: string }
  | { event_id: string; timestamp: number; type: "POSITION_UPDATED"; wallet_id: string; position: PositionRecord }
  | { event_id: string; timestamp: number; type: "WALLET_UPDATED"; wallet: WalletBalance }
  | {
      event_id: string;
      timestamp: number;
      type: "SETTLEMENT";
      market: MarketSymbol;
      outcome: "UP" | "DOWN";
      settled_order_ids: string[];
    };

type NewExchangeEvent = ExchangeEvent extends infer Event
  ? Event extends ExchangeEvent
    ? Omit<Event, "event_id" | "timestamp">
    : never
  : never;

export const DEFAULT_WALLET_ID = "0x9f3a...c41a";

export const MARKET_CONFIG = {
  "BTC-PERP": { base: 64931, tick: 1.5, volatility: 12, qtyMul: 100, type: "perp" as const },
  "BTC-UPDOWN": { base: 0.55, tick: 0.005, volatility: 0.010, qtyMul: 1, type: "binary" as const },
  "BTC-UPDOWN-15": { base: 0.48, tick: 0.005, volatility: 0.008, qtyMul: 1, type: "binary" as const },
  "BTC-PARLAY": { base: 0.21, tick: 0.005, volatility: 0.012, qtyMul: 1, type: "parlay" as const },
} satisfies Record<MarketSymbol, { base: number; tick: number; volatility: number; qtyMul: number; type: string }>;

export class Rng {
  private state: bigint;

  constructor(seed: bigint | number | string = 1n) {
    this.state = BigInt(seed);
  }

  next(): number {
    this.state = BigInt.asUintN(64, this.state + BigInt("0x9E3779B97F4A7C15"));
    let z = this.state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * BigInt("0xBF58476D1CE4E5B9"));
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * BigInt("0x94D049BB133111EB"));
    z = z ^ (z >> 31n);
    return Number(z) / Number(0xFFFF_FFFF_FFFF_FFFFn);
  }

  uniform(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  step(mag: number): number {
    return (this.next() - 0.5) * 2 * mag;
  }
}

export interface ExchangeStoreOptions {
  clock?: () => number;
  rngSeed?: bigint | number | string;
  initialize?: boolean;
}

export interface SubmitOrderParams {
  wallet_id?: string;
  market: MarketSymbol;
  side: OrderSide;
  price: number;
  qty: number;
  tif: TimeInForce;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isBuyish(side: OrderSide): boolean {
  return side === "BUY" || side === "UP";
}

function positionKey(walletId: string, market: MarketSymbol): string {
  return `${walletId}:${market}`;
}

function buildBook(mid: number, tick: number, rng: Rng, side: "bids" | "asks", levels: number): BookLevel[] {
  const levelsArr: BookLevel[] = [];
  for (let i = 1; i <= levels; i++) {
    const price = side === "bids"
      ? parseFloat((mid - i * tick).toFixed(5))
      : parseFloat((mid + i * tick).toFixed(5));
    const qty = parseFloat(rng.uniform(0.2, 4.2).toFixed(2));
    levelsArr.push({ price, qty });
  }
  return levelsArr;
}

export class ExchangeStore {
  private readonly clock: () => number;
  private readonly rng: Rng;
  private readonly events: ExchangeEvent[] = [];
  private readonly orders = new Map<string, OrderRecord>();
  private readonly fills = new Map<string, FillRecord>();
  private readonly snapshots = new Map<MarketSymbol, MarketSnapshot>();
  private readonly wallets = new Map<string, WalletBalance>();
  private readonly positions = new Map<string, PositionRecord>();
  private eventSeq = 1;
  private orderSeq = 1;
  private fillSeq = 1;

  constructor(options: ExchangeStoreOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.rng = new Rng(options.rngSeed ?? 1n);

    if (options.initialize !== false) {
      this.append({
        type: "WALLET_UPDATED",
        wallet: {
          wallet_id: DEFAULT_WALLET_ID,
          bankroll: 10_000,
          available: 10_000,
          margin_used: 0,
          realized_pnl: 0,
          total_orders: 0,
          cancelled_orders: 0,
          filled_orders: 0,
          cumulative_latency_ms: 0,
          pnl_history: [{ timestamp: this.clock(), pnl: 0 }],
        },
      });

      for (const [symbol, cfg] of Object.entries(MARKET_CONFIG) as [MarketSymbol, typeof MARKET_CONFIG[MarketSymbol]][]) {
        const mid = cfg.base;
        this.append({
          type: "MARKET_TICK",
          snapshot: {
            symbol,
            mid,
            bids: buildBook(mid, cfg.tick, this.rng, "bids", 10),
            asks: buildBook(mid, cfg.tick, this.rng, "asks", 10),
            spread: cfg.tick * 2,
            vol_24h: symbol === "BTC-PERP" ? 4_210_000 : 100_000,
            change_24h: 0,
            ...(cfg.type === "perp" ? { funding_rate: 0.001 } : {}),
            ...((cfg.type === "binary" || cfg.type === "parlay") ? { window_remaining_ms: 300_000 } : {}),
          },
        });
      }
    }
  }

  static replay(events: ExchangeEvent[]): ExchangeStore {
    const store = new ExchangeStore({ initialize: false });
    for (const event of events) {
      const copied = clone(event);
      store.events.push(copied);
      store.apply(copied);
      store.bumpSequences(copied);
    }
    return store;
  }

  nextOrderId(): string {
    return `ord_${(this.orderSeq++).toString().padStart(6, "0")}`;
  }

  nextFillId(): string {
    return `fill_${(this.fillSeq++).toString().padStart(6, "0")}`;
  }

  getEventLog(): ExchangeEvent[] {
    return clone(this.events);
  }

  getOrder(id: string): OrderRecord | undefined {
    return this.orders.get(id);
  }

  getWallet(id: string = DEFAULT_WALLET_ID): WalletBalance | undefined {
    return this.wallets.get(id);
  }

  getMarketSnapshot(symbol: MarketSymbol): MarketSnapshot | undefined {
    return this.snapshots.get(symbol);
  }

  getAllMarketSnapshots(): MarketSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  getOrdersByStatus(status: OrderStatus): OrderRecord[] {
    return Array.from(this.orders.values()).filter((order) => order.status === status);
  }

  getRestingOrders(): OrderRecord[] {
    return this.getOrdersByStatus("resting");
  }

  getFillHistory(limit = 50): FillRecord[] {
    return Array.from(this.fills.values()).slice(-limit);
  }

  getPosition(walletId: string, market: MarketSymbol): PositionRecord | undefined {
    return this.positions.get(positionKey(walletId, market));
  }

  getAllPositions(walletId: string = DEFAULT_WALLET_ID): PositionRecord[] {
    return Array.from(this.positions.values()).filter((position) => position.wallet_id === walletId);
  }

  updateMarketSnapshot(snapshot: MarketSnapshot): void {
    this.append({ type: "MARKET_TICK", snapshot });
  }

  updateWallet(wallet: WalletBalance): void {
    const current = this.wallets.get(wallet.wallet_id);
    const next = { ...wallet };
    if (current && current.realized_pnl !== next.realized_pnl) {
      next.pnl_history = [
        ...current.pnl_history,
        { timestamp: this.clock(), pnl: next.realized_pnl },
      ].slice(-100);
    }
    this.append({ type: "WALLET_UPDATED", wallet: next });
  }

  upsertPosition(position: PositionRecord): void {
    this.append({ type: "POSITION_UPDATED", wallet_id: position.wallet_id, position });
  }

  upsertOrder(order: OrderRecord): void {
    const next = { ...order, updated_at: this.clock() };
    const current = this.orders.get(order.order_id);
    if (!current && next.status === "rejected") {
      this.append({ type: "ORDER_REJECTED", order_id: next.order_id, reason: "legacy rejection", order: next });
      return;
    }
    if (!current) {
      this.append({ type: "ORDER_ACCEPTED", order: next });
      return;
    }
    if (next.status === "filled") {
      this.append({ type: "ORDER_FILLED", order: next });
      return;
    }
    if (next.status === "partially_filled") {
      this.append({
        type: "ORDER_PARTIALLY_FILLED",
        order: next,
        fill: this.syntheticFillForOrder(next),
      });
      return;
    }
    if (next.status === "cancelled") {
      this.append({ type: "ORDER_CANCELLED", order: next });
      return;
    }
    this.append({ type: "ORDER_ACCEPTED", order: next });
  }

  recordFill(fill: FillRecord): void {
    this.fills.set(fill.fill_id, fill);
  }

  submitOrder(params: SubmitOrderParams): OrderRecord {
    const walletId = params.wallet_id ?? DEFAULT_WALLET_ID;
    const now = this.clock();
    const order: OrderRecord = {
      order_id: this.nextOrderId(),
      wallet_id: walletId,
      market: params.market,
      side: params.side,
      price: params.price,
      qty: params.qty,
      filled: 0,
      remaining: params.qty,
      status: "resting",
      tif: params.tif,
      created_at: now,
      updated_at: now,
    };

    const wallet = this.getWallet(walletId);
    const rejection = this.validateOrder(order, wallet);
    if (rejection) {
      const rejected = { ...order, status: "rejected" as const, remaining: params.qty };
      this.append({ type: "ORDER_REJECTED", order_id: rejected.order_id, reason: rejection, order: rejected });
      return rejected;
    }

    this.append({ type: "ORDER_ACCEPTED", order });
    this.updateWallet({ ...wallet!, total_orders: wallet!.total_orders + 1 });

    const snap = this.getMarketSnapshot(params.market);
    const cfg = MARKET_CONFIG[params.market];
    const mid = snap?.mid ?? cfg.base;
    const fillPrice = params.price === 0
      ? (isBuyish(params.side) ? mid + cfg.tick : mid - cfg.tick)
      : params.price;
    const crossable = params.price === 0
      || (isBuyish(params.side) ? params.price >= mid + cfg.tick : params.price <= mid - cfg.tick);

    if (crossable) {
      return this.fillOrder(order, params.qty, fillPrice);
    }

    if (params.tif === "IOC") {
      return this.cancelOrder(order.order_id, "IOC expired") ?? order;
    }

    return order;
  }

  cancelOrder(orderId: string, reason = "cancel requested"): OrderRecord | undefined {
    const current = this.orders.get(orderId);
    if (!current) {
      this.append({ type: "ORDER_REJECTED", order_id: orderId, reason: "unknown order" });
      return undefined;
    }
    if (current.status !== "resting" && current.status !== "partially_filled") {
      this.append({ type: "ORDER_REJECTED", order_id: orderId, reason: `cannot cancel ${current.status} order`, order: current });
      return current;
    }

    const cancelled: OrderRecord = {
      ...current,
      status: "cancelled",
      updated_at: this.clock(),
    };
    this.append({ type: "ORDER_CANCELLED", order: cancelled, reason });

    const wallet = this.getWallet(current.wallet_id);
    if (wallet) {
      this.updateWallet({ ...wallet, cancelled_orders: wallet.cancelled_orders + 1 });
    }

    return cancelled;
  }

  fillRestingOrdersAtMid(symbol: MarketSymbol, newMid: number): FillRecord[] {
    const cfg = MARKET_CONFIG[symbol];
    const bestBid = newMid - cfg.tick;
    const bestAsk = newMid + cfg.tick;
    const fills: FillRecord[] = [];

    for (const order of this.getRestingOrders().filter((candidate) => candidate.market === symbol)) {
      const shouldFill = isBuyish(order.side) ? order.price >= bestAsk : order.price <= bestBid;
      if (!shouldFill) continue;
      const updated = this.fillOrder(order, order.remaining, order.price);
      const fill = this.getFillHistory(1)[0];
      if (updated.status === "filled" && fill?.order_id === order.order_id) {
        fills.push(fill);
      }
    }

    return fills;
  }

  settleBinaryMarket(symbol: MarketSymbol, outcome: "UP" | "DOWN"): string[] {
    const settledOrderIds: string[] = [];
    for (const order of this.getRestingOrders().filter((candidate) => candidate.market === symbol)) {
      const wins = (order.side === "UP" || order.side === "BUY") === (outcome === "UP");
      const settled = this.fillOrder(order, order.remaining, wins ? 1 : 0);
      settledOrderIds.push(settled.order_id);
    }
    this.append({ type: "SETTLEMENT", market: symbol, outcome, settled_order_ids: settledOrderIds });
    return settledOrderIds;
  }

  private validateOrder(order: OrderRecord, wallet: WalletBalance | undefined): string | undefined {
    if (!wallet) return `wallet '${order.wallet_id}' not found`;
    if (!Number.isFinite(order.qty) || order.qty <= 0) return "quantity must be greater than zero";
    if (!Number.isFinite(order.price) || order.price < 0) return "price must be zero for market orders or greater than zero";
    if (!MARKET_CONFIG[order.market]) return `unknown market '${order.market}'`;

    const estimatedCost = this.estimateOrderCost(order);
    if (wallet.available < estimatedCost) {
      return `insufficient available balance: need ${estimatedCost.toFixed(2)}, have ${wallet.available.toFixed(2)}`;
    }

    return undefined;
  }

  private estimateOrderCost(order: OrderRecord): number {
    const snap = this.getMarketSnapshot(order.market);
    const cfg = MARKET_CONFIG[order.market];
    const mid = snap?.mid ?? cfg.base;
    const price = order.price === 0
      ? (isBuyish(order.side) ? mid + cfg.tick : mid - cfg.tick)
      : order.price;
    return Math.max(0, price * order.qty);
  }

  private fillOrder(order: OrderRecord, qty: number, price: number): OrderRecord {
    const now = this.clock();
    const fillQty = Math.min(qty, order.remaining);
    const filled = order.filled + fillQty;
    const remaining = Math.max(0, order.qty - filled);
    const status: OrderStatus = remaining > 0 ? "partially_filled" : "filled";
    const updated: OrderRecord = {
      ...order,
      filled,
      remaining,
      status,
      updated_at: now,
    };
    const fillPrice = parseFloat(price.toFixed(5));
    const fill: FillRecord = {
      fill_id: this.nextFillId(),
      order_id: order.order_id,
      wallet_id: order.wallet_id,
      market: order.market,
      side: order.side,
      price: fillPrice,
      qty: fillQty,
      fee: parseFloat((fillQty * fillPrice * 0.0005).toFixed(4)),
      timestamp: now,
    };

    this.append({
      type: status === "filled" ? "ORDER_FILLED" : "ORDER_PARTIALLY_FILLED",
      order: updated,
      fill,
    } as Extract<ExchangeEvent, { type: "ORDER_FILLED" | "ORDER_PARTIALLY_FILLED" }>);

    const wallet = this.getWallet(order.wallet_id);
    if (wallet) {
      const notional = fill.qty * fill.price;
      const nextRealizedPnl = fill.price === 0
        ? wallet.realized_pnl - order.qty * order.price
        : wallet.realized_pnl;
      this.updateWallet({
        ...wallet,
        available: Math.max(0, wallet.available - notional - fill.fee),
        realized_pnl: nextRealizedPnl,
        filled_orders: wallet.filled_orders + (status === "filled" ? 1 : 0),
        cumulative_latency_ms: wallet.cumulative_latency_ms + (now - order.created_at),
      });
    }

    this.updatePositionFromFill(fill);
    return updated;
  }

  private updatePositionFromFill(fill: FillRecord): void {
    const signedFill = isBuyish(fill.side) ? fill.qty : -fill.qty;
    const current = this.getPosition(fill.wallet_id, fill.market);
    const oldSigned = current ? (current.side === "LONG" ? current.size : -current.size) : 0;
    const newSigned = oldSigned + signedFill;

    if (newSigned === 0) {
      return;
    }

    const sameDirection = oldSigned === 0 || Math.sign(oldSigned) === Math.sign(signedFill);
    const size = Math.abs(newSigned);
    const entry = sameDirection && current
      ? ((current.entry_price * Math.abs(oldSigned)) + (fill.price * Math.abs(signedFill))) / (Math.abs(oldSigned) + Math.abs(signedFill))
      : fill.price;
    const snap = this.getMarketSnapshot(fill.market);
    const mark = snap?.mid ?? fill.price;
    const direction = Math.sign(newSigned);
    const unrealized = (mark - entry) * size * direction;
    const position: PositionRecord = {
      wallet_id: fill.wallet_id,
      market: fill.market,
      side: direction > 0 ? "LONG" : "SHORT",
      size: parseFloat(size.toFixed(8)),
      entry_price: parseFloat(entry.toFixed(5)),
      mark_price: mark,
      unrealized_pnl: parseFloat(unrealized.toFixed(4)),
      realized_pnl: current?.realized_pnl ?? 0,
      margin: parseFloat((entry * size * 0.1).toFixed(4)),
      liquidation_price: parseFloat((direction > 0 ? entry * 0.9 : entry * 1.1).toFixed(5)),
    };
    this.upsertPosition(position);
  }

  private append(event: NewExchangeEvent): ExchangeEvent {
    const full = {
      ...event,
      event_id: `evt_${(this.eventSeq++).toString().padStart(8, "0")}`,
      timestamp: this.clock(),
    } as ExchangeEvent;
    this.events.push(full);
    this.apply(full);
    return full;
  }

  private apply(event: ExchangeEvent): void {
    switch (event.type) {
      case "MARKET_TICK":
        this.snapshots.set(event.snapshot.symbol, clone(event.snapshot));
        break;
      case "ORDER_ACCEPTED":
        this.orders.set(event.order.order_id, clone(event.order));
        break;
      case "ORDER_REJECTED":
        if (event.order) this.orders.set(event.order.order_id, clone(event.order));
        break;
      case "ORDER_PARTIALLY_FILLED":
      case "ORDER_FILLED":
        this.orders.set(event.order.order_id, clone(event.order));
        if (event.fill) this.fills.set(event.fill.fill_id, clone(event.fill));
        break;
      case "ORDER_CANCELLED":
        this.orders.set(event.order.order_id, clone(event.order));
        break;
      case "POSITION_UPDATED":
        this.positions.set(positionKey(event.wallet_id, event.position.market), clone(event.position));
        break;
      case "WALLET_UPDATED":
        this.wallets.set(event.wallet.wallet_id, clone(event.wallet));
        break;
      case "SETTLEMENT":
        break;
    }
  }

  private syntheticFillForOrder(order: OrderRecord): FillRecord {
    return {
      fill_id: this.nextFillId(),
      order_id: order.order_id,
      wallet_id: order.wallet_id,
      market: order.market,
      side: order.side,
      price: order.price,
      qty: order.filled,
      fee: parseFloat((order.filled * order.price * 0.0005).toFixed(4)),
      timestamp: this.clock(),
    };
  }

  private bumpSequences(event: ExchangeEvent): void {
    const eventSeq = Number(event.event_id.replace("evt_", ""));
    if (Number.isFinite(eventSeq)) this.eventSeq = Math.max(this.eventSeq, eventSeq + 1);

    const order = "order" in event ? event.order : undefined;
    if (order) {
      const orderSeq = Number(order.order_id.replace("ord_", ""));
      if (Number.isFinite(orderSeq)) this.orderSeq = Math.max(this.orderSeq, orderSeq + 1);
    }

    const fill = "fill" in event ? event.fill : undefined;
    if (fill) {
      const fillSeq = Number(fill.fill_id.replace("fill_", ""));
      if (Number.isFinite(fillSeq)) this.fillSeq = Math.max(this.fillSeq, fillSeq + 1);
    }
  }
}
