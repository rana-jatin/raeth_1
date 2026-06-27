# RAETH Matching Engine — Technical Reference

## Overview

The RAETH matching engine is a **deterministic central limit order book (CLOB)** written in safe Rust and compiled to WebAssembly. It enforces strict **price-time (FIFO) priority**, conserves quantities exactly, never lets the book cross, and replays bit-for-bit identically across machines.

Performance: ~**14.4 million orders/second** (~70 ns/order) on a laptop CPU. The hot path performs **no heap allocation** in steady state.

## Core Data Types

### Price
```rust
pub type Price = i64;  // integer ticks, signed (derivatives can go negative)
```
Prices are integer ticks — never floating point. The exchange cannot tolerate IEEE-754 rounding or non-associativity. A price in USD is `price_ticks * tick_size`.

### Qty
```rust
pub type Qty = u64;  // whole units, always positive
```
Quantities are whole units (shares, lots, contracts). Zero quantity is rejected — a resting order with qty = 0 is a contradiction.

### OrderId
```rust
pub struct OrderId(pub u64);  // monotonically increasing
```
The engine assigns order IDs from a monotonic counter. The ID also serves as the **arrival timestamp** for FIFO tie-breaking — no separate sequence number needed. Because assignment is deterministic, replaying a recorded command log produces identical event streams.

### Side
```rust
pub enum Side { Buy, Sell }
```

### TimeInForce
```rust
pub enum TimeInForce {
    Gtc,  // Good-til-Cancelled: unfilled remainder rests on the book
    Ioc,  // Immediate-or-Cancel: match now, cancel remainder (never rests)
}
```

## Commands

The engine accepts three commands:

### SubmitLimit
```rust
Command::SubmitLimit {
    side: Side,
    price: Price,  // limit price in integer ticks
    qty: Qty,      // quantity in whole units, must be > 0
    tif: TimeInForce,
}
```
Submit a limit order. The order is first matched against the opposite side at better or equal prices (aggressor logic), then the remainder rests (GTC) or is cancelled (IOC).

### SubmitMarket
```rust
Command::SubmitMarket {
    side: Side,
    qty: Qty,  // must be > 0
}
```
Submit a market order. Crosses at any available price. The unfilled remainder (if any, e.g. book is empty) is cancelled — market orders never rest.

### Cancel
```rust
Command::Cancel {
    order_id: OrderId,
}
```
Cancel a resting order by its engine-assigned ID. Succeeds only for currently-resting orders. Returns `Rejected { reason: UnknownOrder }` if the ID is unknown, already filled, or already cancelled.

## Events

Every command produces one or more events. Events are the engine's **only output** and the source of truth for all downstream systems.

### Accepted
```rust
Event::Accepted {
    order_id: OrderId,
    side: Side,
    price: Price,  // 0 for market orders (meaningless)
    qty: Qty,
}
```
Emitted first for every admitted order. Contains the engine-assigned ID.

### Trade
```rust
Event::Trade {
    taker: OrderId,    // the aggressor
    maker: OrderId,    // the resting order
    price: Price,      // the maker's resting price (price improvement goes to taker)
    qty: Qty,          // quantity traded
    taker_side: Side,
}
```
Emitted when a quantity is matched. Fills trade at the **maker's price** — any price improvement accrues to the taker (aggressor).

### Filled
```rust
Event::Filled { order_id: OrderId }
```
Emitted when an order's remaining quantity reaches zero. Can be emitted for both makers (fully consumed by a trade) and aggressors (fully filled).

### Cancelled
```rust
Event::Cancelled {
    order_id: OrderId,
    remaining: Qty,  // units returned
}
```
Emitted when an order leaves the book without fully filling: explicit cancel, IOC remainder, or unfilled market order remainder.

### Rejected
```rust
Event::Rejected {
    order_id: Option<OrderId>,  // None for rejected submits (no ID assigned), Some for cancel rejects
    reason: RejectReason,
}
```

Reject reasons:
- `ZeroQty` — the submitted quantity was 0
- `UnknownOrder` — a cancel referenced an ID not currently resting

## Matching Algorithm

The matching algorithm uses **price-time (FIFO) priority**:

1. An aggressive order walks the opposite side from **best price outward** (best bid = highest; best ask = lowest).
2. Each fill trades at the **maker's resting price** (price improvement accrues to the aggressor).
3. A buy crosses asks priced **≤** its limit. A sell crosses bids priced **≥** its limit. Market orders cross at any price.
4. Makers at the same price are served in **strict arrival order** (FIFO by OrderId, which is the arrival timestamp).
5. The aggressor's unfilled remainder:
   - GTC limit: rests on the book
   - IOC limit: cancelled
   - Market: cancelled (never rests)

**The book never crosses**: `best_bid < best_ask` is maintained as an invariant at all times.

## Order Book Data Structure

### Slab + Intrusive Lists
Order nodes live in a pooled `Vec<Node>` (the **slab**). Each price level contains an **intrusive doubly-linked FIFO list** of nodes. A `HashMap<OrderId, u32>` maps each live order to its slab index.

Benefits:
- **O(1) cancel**: Look up the slab index, unlink the node (patch neighbours), return slot to free list. No scan of the level.
- **No hot-path allocation**: Freed slots are recycled. The event buffer is also reused across calls.

### Price Ladder
Each side uses a `BTreeMap<Price, PriceLevel>`:
- Best bid = last key (highest price)
- Best ask = first key (lowest price)
- No `Reverse` wrapper needed — natural ordering works for both sides

Each `PriceLevel` stores:
- `head`, `tail`: slab indices of the FIFO list endpoints
- `total_qty`: cached sum for O(1) depth queries

## WASM Interface

The engine compiles to WASM with `wasm_bindgen`. JavaScript/TypeScript interface:

```typescript
import init, { WasmSimulator } from "./wasm/raeth.js";

// Initialize WASM
await init(wasmUrl);

// Create simulator
const simulator = WasmSimulator.new(seed: bigint, initialMidTicks: bigint);

// Tick the simulation (generates background trading)
const result: string = simulator.tick(steps: number);
// result is JSON: { mid: bigint, snapshot: Order[], events: Event[] }

// Submit a limit order
const events: string = simulator.submit_limit(
    side: "BUY" | "SELL",
    price: bigint,  // in ticks
    qty: bigint,    // in whole units
    tif: "GTC" | "IOC"
);
// returns JSON array of Event objects

// Submit a market order
const events: string = simulator.submit_market(
    side: "BUY" | "SELL",
    qty: bigint
);

// Cancel an order
const events: string = simulator.cancel(orderId: bigint);

// Free the simulator
simulator.free();
```

Price conversion: `priceTicks = BigInt(Math.round(priceUSD / tickSize))`
Qty conversion: `qtyUnits = BigInt(Math.round(qty * qtyMultiplier))` (perps: multiplier=100, binaries: multiplier=1)

## Property Guarantees (Tested)

- **Book never crosses**: `best_bid < best_ask` after every command
- **Share conservation**: for every order, `submitted == filled + resting + cancelled`. No shares created or destroyed.
- **Price-time priority**: at equal price, earlier (lower-ID) orders fill first
- **No zero-quantity order ever rests**
- **Cancel is surgical**: removes exactly one order; rest of book is byte-for-byte unchanged
- **Determinism**: replaying the same command log produces an identical event stream on any machine

## Performance Numbers

| Metric | Value |
|--------|-------|
| Throughput (5M ops) | **14.38 M ops/sec** |
| Per operation | **~70 ns** |
| p50 latency | ~100 ns |
| p99 latency | 400 ns |
| p99.9 latency | 600 ns |
| Max latency | 2.0 µs |
| Cancel cost | O(1), independent of book depth |

Benchmarked: Intel Core i7-14700HX, Windows 11, `rustc 1.84.0`, `--release`, `lto=true`, `codegen-units=1`.
