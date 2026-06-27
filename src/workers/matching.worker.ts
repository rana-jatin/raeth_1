import init, { WasmSimulator } from "../wasm/raeth.js";

let simulator: WasmSimulator | null = null;
let tickSize: number = 1.0;
let qtyMultiplier: number = 1;

self.addEventListener("message", async (e: MessageEvent) => {
  const { type, data } = e.data;

  if (type === "INIT") {
    try {
      await init();
      self.postMessage({ type: "INIT_DONE" });
    } catch (err: any) {
      self.postMessage({ type: "ERROR", error: err.message });
    }
  } else if (type === "RESET") {
    const { symbol, base, tick, type: mktType } = data;
    tickSize = tick;
    qtyMultiplier = mktType === "perp" ? 100 : 1;

    const initialMidTicks = BigInt(Math.round(base / tickSize));
    const seed = BigInt(Date.now() % 1000000007);

    if (simulator) {
      simulator.free();
    }
    simulator = WasmSimulator.new(seed, initialMidTicks);
    self.postMessage({ type: "RESET_DONE", symbol });
  } else if (type === "TICK") {
    if (!simulator) return;
    // Tick the simulation by 1..3 steps to generate background trading flow
    const steps = 1 + Math.floor(Math.random() * 3);
    const resultStr = simulator.tick(steps);
    const result = JSON.parse(resultStr);

    const midPrice = result.mid * tickSize;

    const bids: { px: number; qty: number }[] = [];
    const asks: { px: number; qty: number }[] = [];

    // Group and aggregate resting orders by price levels
    const levelMap: Record<string, { bid: number; ask: number }> = {};
    for (const ord of result.snapshot) {
      const px = ord.price * tickSize;
      const qty = ord.qty / qtyMultiplier;
      const key = px.toFixed(6);
      if (!levelMap[key]) {
        levelMap[key] = { bid: 0, ask: 0 };
      }
      if (ord.side === "BUY") {
        levelMap[key].bid += qty;
      } else {
        levelMap[key].ask += qty;
      }
    }

    for (const [key, val] of Object.entries(levelMap)) {
      const px = parseFloat(key);
      if (val.bid > 0) bids.push({ px, qty: parseFloat(val.bid.toFixed(2)) });
      if (val.ask > 0) asks.push({ px, qty: parseFloat(val.ask.toFixed(2)) });
    }

    bids.sort((a, b) => b.px - a.px);
    asks.sort((a, b) => a.px - b.px);

    const events = result.events.map((ev: any) => ({
      ...ev,
      price: ev.price ? ev.price * tickSize : undefined,
      qty: ev.qty ? ev.qty / qtyMultiplier : undefined,
      remaining: ev.remaining ? ev.remaining / qtyMultiplier : undefined,
    }));

    self.postMessage({
      type: "TICK_DONE",
      data: {
        midPrice,
        bids: bids.slice(0, 10),
        asks: asks.slice(0, 10),
        events,
      },
    });
  } else if (type === "SUBMIT_LIMIT") {
    if (!simulator) return;
    const { side, price, qty, tif, isAgent, reqId } = data;
    const priceTicks = BigInt(Math.round(price / tickSize));
    const qtyUnits = BigInt(Math.round(qty * qtyMultiplier));

    const eventsStr = simulator.submit_limit(side, priceTicks, qtyUnits, tif);
    const events = JSON.parse(eventsStr).map((ev: any) => ({
      ...ev,
      price: ev.price ? ev.price * tickSize : undefined,
      qty: ev.qty ? ev.qty / qtyMultiplier : undefined,
      remaining: ev.remaining ? ev.remaining / qtyMultiplier : undefined,
    }));

    self.postMessage({ type: "ORDER_EVENT", events, isAgent, isUser: !isAgent, reqId });
  } else if (type === "SUBMIT_MARKET") {
    if (!simulator) return;
    const { side, qty, isAgent, reqId } = data;
    const qtyUnits = BigInt(Math.round(qty * qtyMultiplier));

    const eventsStr = simulator.submit_market(side, qtyUnits);
    const events = JSON.parse(eventsStr).map((ev: any) => ({
      ...ev,
      price: ev.price ? ev.price * tickSize : undefined,
      qty: ev.qty ? ev.qty / qtyMultiplier : undefined,
      remaining: ev.remaining ? ev.remaining / qtyMultiplier : undefined,
    }));

    self.postMessage({ type: "ORDER_EVENT", events, isAgent, isUser: !isAgent, reqId });
  } else if (type === "CANCEL") {
    if (!simulator) return;
    const { orderId, isAgent, reqId } = data;
    const eventsStr = simulator.cancel(BigInt(orderId));
    const events = JSON.parse(eventsStr).map((ev: any) => ({
      ...ev,
      price: ev.price ? ev.price * tickSize : undefined,
      qty: ev.qty ? ev.qty / qtyMultiplier : undefined,
      remaining: ev.remaining ? ev.remaining / qtyMultiplier : undefined,
    }));

    self.postMessage({ type: "ORDER_EVENT", events, isAgent, isUser: !isAgent, reqId });
  }
});
