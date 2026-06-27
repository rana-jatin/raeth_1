import { describe, expect, it } from "vitest";
import { DEFAULT_WALLET_ID, ExchangeStore } from "./store";

function deterministicClock(start = 1_700_000_000_000) {
  let now = start;
  return () => now++;
}

describe("ExchangeStore", () => {
  it("replays event-log projections deterministically", () => {
    const store = new ExchangeStore({ clock: deterministicClock(), rngSeed: 42n });
    store.submitOrder({
      market: "BTC-PERP",
      side: "BUY",
      price: 0,
      qty: 0.05,
      tif: "IOC",
    });

    const replayed = ExchangeStore.replay(store.getEventLog());

    expect(replayed.getAllMarketSnapshots()).toEqual(store.getAllMarketSnapshots());
    expect(replayed.getWallet(DEFAULT_WALLET_ID)).toEqual(store.getWallet(DEFAULT_WALLET_ID));
    expect(replayed.getFillHistory()).toEqual(store.getFillHistory());
  });

  it("rejects zero-quantity orders without touching wallet counters", () => {
    const store = new ExchangeStore({ clock: deterministicClock(), rngSeed: 42n });
    const walletBefore = store.getWallet(DEFAULT_WALLET_ID)!;

    const order = store.submitOrder({
      market: "BTC-PERP",
      side: "BUY",
      price: 65_000,
      qty: 0,
      tif: "GTC",
    });

    expect(order.status).toBe("rejected");
    expect(store.getWallet(DEFAULT_WALLET_ID)!.total_orders).toBe(walletBefore.total_orders);
    expect(store.getEventLog().at(-1)?.type).toBe("ORDER_REJECTED");
  });

  it("fills market orders and records wallet-scoped fills", () => {
    const store = new ExchangeStore({ clock: deterministicClock(), rngSeed: 42n });

    const order = store.submitOrder({
      market: "BTC-PERP",
      side: "BUY",
      price: 0,
      qty: 0.1,
      tif: "IOC",
    });

    const fills = store.getFillHistory();
    const wallet = store.getWallet(DEFAULT_WALLET_ID)!;

    expect(order.status).toBe("filled");
    expect(fills).toHaveLength(1);
    expect(fills[0].wallet_id).toBe(DEFAULT_WALLET_ID);
    expect(wallet.total_orders).toBe(1);
    expect(wallet.filled_orders).toBe(1);
  });

  it("cancels non-crossing IOC orders", () => {
    const store = new ExchangeStore({ clock: deterministicClock(), rngSeed: 42n });

    const order = store.submitOrder({
      market: "BTC-PERP",
      side: "BUY",
      price: 60_000,
      qty: 0.1,
      tif: "IOC",
    });

    const wallet = store.getWallet(DEFAULT_WALLET_ID)!;

    expect(order.status).toBe("cancelled");
    expect(wallet.total_orders).toBe(1);
    expect(wallet.cancelled_orders).toBe(1);
  });

  it("cancels resting GTC orders and rejects duplicate cancels", () => {
    const store = new ExchangeStore({ clock: deterministicClock(), rngSeed: 42n });
    const order = store.submitOrder({
      market: "BTC-PERP",
      side: "BUY",
      price: 60_000,
      qty: 0.1,
      tif: "GTC",
    });

    const cancelled = store.cancelOrder(order.order_id);
    const duplicate = store.cancelOrder(order.order_id);

    expect(order.status).toBe("resting");
    expect(cancelled?.status).toBe("cancelled");
    expect(duplicate?.status).toBe("cancelled");
    expect(store.getEventLog().at(-1)?.type).toBe("ORDER_REJECTED");
  });
});
