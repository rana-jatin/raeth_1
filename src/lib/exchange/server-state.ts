import {
  DEFAULT_WALLET_ID,
  ExchangeStore,
  MARKET_CONFIG,
  type ExchangeEvent,
  type FillRecord,
  type MarketSnapshot,
  type MarketSymbol,
  type OrderRecord,
  type OrderSide,
  type OrderStatus,
  type PositionRecord,
  type ScopedRequestContext,
  type SubWallet,
  type TimeInForce,
  type UserAccount,
  type WalletBalance,
  type ApiKey,
  type Session,
} from "./store";

export {
  DEFAULT_WALLET_ID,
  ExchangeStore,
  MARKET_CONFIG,
  type ApiKey,
  type ExchangeEvent,
  type FillRecord,
  type MarketSnapshot,
  type MarketSymbol,
  type OrderRecord,
  type OrderSide,
  type OrderStatus,
  type PositionRecord,
  type ScopedRequestContext,
  type Session,
  type SubWallet,
  type TimeInForce,
  type UserAccount,
  type WalletBalance,
};

const exchangeStore = new ExchangeStore();

export function getExchangeStore(): ExchangeStore {
  return exchangeStore;
}

export function nextOrderId(): string {
  return exchangeStore.nextOrderId();
}

export function nextFillId(): string {
  return exchangeStore.nextFillId();
}

export function getEventLog(): ExchangeEvent[] {
  return exchangeStore.getEventLog();
}

export function getOrder(id: string): OrderRecord | undefined {
  return exchangeStore.getOrder(id);
}

export function getWallet(id: string = DEFAULT_WALLET_ID): WalletBalance | undefined {
  return exchangeStore.getWallet(id);
}

export function getMarketSnapshot(symbol: MarketSymbol): MarketSnapshot | undefined {
  return exchangeStore.getMarketSnapshot(symbol);
}

export function getAllMarketSnapshots(): MarketSnapshot[] {
  return exchangeStore.getAllMarketSnapshots();
}

export function getDefaultWalletId(): string {
  return DEFAULT_WALLET_ID;
}

export function getOrdersByStatus(status: OrderStatus): OrderRecord[] {
  return exchangeStore.getOrdersByStatus(status);
}

export function getRestingOrders(): OrderRecord[] {
  return exchangeStore.getRestingOrders();
}

export function getFillHistory(limit = 50): FillRecord[] {
  return exchangeStore.getFillHistory(limit);
}

export function getPosition(walletId: string, market: MarketSymbol): PositionRecord | undefined {
  return exchangeStore.getPosition(walletId, market);
}

export function getAllPositions(walletId: string = DEFAULT_WALLET_ID): PositionRecord[] {
  return exchangeStore.getAllPositions(walletId);
}

export function upsertOrder(order: OrderRecord): void {
  exchangeStore.upsertOrder(order);
}

export function recordFill(fill: FillRecord): void {
  exchangeStore.recordFill(fill);
}

export function updateMarketSnapshot(snapshot: MarketSnapshot): void {
  exchangeStore.updateMarketSnapshot(snapshot);
}

export function updateWallet(wallet: WalletBalance): void {
  exchangeStore.updateWallet(wallet);
}

export function upsertPosition(position: PositionRecord): void {
  exchangeStore.upsertPosition(position);
}
