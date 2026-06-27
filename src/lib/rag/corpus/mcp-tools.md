# RAETH MCP Tool Catalog

## Overview

RAETH exposes a **remote Model Context Protocol (MCP) server** that lets any LLM client (Claude, GPT-4, or any MCP-compatible agent) trade directly by calling structured tools. The MCP server is available at `https://raeth.exchange/mcp`.

### Connecting

**Claude Desktop / CLI:**
```bash
claude mcp add --transport http raeth https://raeth.exchange/mcp
```

**Claude configuration file (`claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "raeth": {
      "transport": "http",
      "url": "https://raeth.exchange/mcp"
    }
  }
}
```

**Any MCP client:**
```
Transport: HTTP
URL: https://raeth.exchange/mcp
Auth: Bearer rk_test_<key>  (pass in X-Api-Key header or Authorization header)
```

## Available Tools

### get_markets

List all open markets with their current state.

Parameters: none

Returns:
```json
[
  {
    "symbol": "BTC-PERP",
    "name": "BTC Perpetual",
    "type": "perp",
    "mark": 64931.0,
    "tick": 1.5,
    "change_24h": "+0.37%",
    "vol_24h": "$4.21m"
  }
]
```

Use case: Agent wants to know which markets are tradeable and their current marks before deciding where to trade.

### get_orderbook

Stream current order book depth for a market symbol.

Parameters:
- `symbol` (string, required): market symbol — one of `BTC-PERP`, `BTC-UPDOWN`, `BTC-UPDOWN-15`, `BTC-PARLAY`
- `levels` (number, optional, default 10): number of price levels per side to return

Returns:
```json
{
  "symbol": "BTC-PERP",
  "bids": [
    { "price": 64929.5, "qty": 2.3 },
    { "price": 64928.0, "qty": 1.1 }
  ],
  "asks": [
    { "price": 64932.5, "qty": 0.8 },
    { "price": 64934.0, "qty": 3.2 }
  ],
  "mid": 64931.0,
  "spread": 3.0,
  "timestamp": 1719412800000
}
```

Use case: Agent reads the book to decide limit order placement.

### place_order

Submit a limit or market order on behalf of the scoped sub-wallet.

Parameters:
- `market` (string, required): market symbol
- `side` (string, required): `BUY` or `SELL` for perps; `UP` or `DOWN` for binaries/parlays
- `size` (number, required): quantity in whole units, must be > 0
- `price` (number, optional): limit price as decimal. Omit for market orders.
- `tif` (string, optional): `GTC` (default) or `IOC`

Returns:
```json
{
  "order_id": "0x4c2…91",
  "status": "accepted",
  "market": "BTC-UPDOWN",
  "side": "UP",
  "size": 120,
  "price": 0.55,
  "tif": "GTC"
}
```

Errors:
- If `size` is 0, returns `{ "error": "ZERO_QTY" }`
- If insufficient balance: `{ "error": "INSUFFICIENT_BALANCE" }`
- If price is outside allowed band: `{ "error": "PRICE_BAND" }`

Use case: Agent places a directional trade after analyzing the book.

### get_positions

Read current open positions, margin usage, and realized PnL.

Parameters: none

Returns:
```json
[
  {
    "market": "BTC-PERP",
    "side": "LONG",
    "size": 0.5,
    "entry_price": 64800.0,
    "mark_price": 64931.0,
    "unrealized_pnl": 65.5,
    "realized_pnl": 54.0,
    "margin": 324.0,
    "liquidation_price": 62000.0
  }
]
```

Use case: Agent checks its current inventory before placing new orders.

### cancel_order

Cancel a resting order by its ID.

Parameters:
- `order_id` (string, required): the engine-assigned order ID from `place_order` or fills

Returns:
```json
{
  "order_id": "0x4c2…91",
  "status": "cancelled",
  "remaining": 80
}
```

Error if order not found or already filled/cancelled:
```json
{
  "error": "UNKNOWN_ORDER",
  "message": "Order 0x4c2…91 is not currently resting"
}
```

Use case: Agent cancels a stale resting order before repricing.

### stream_fills

Subscribe to real-time fills and settlement events for the agent's sub-wallet.

Parameters:
- `markets` (array of strings, optional): filter to specific markets. Omit to receive all fills.

Returns a stream of fill events:
```json
{
  "type": "FILL",
  "fill_id": "f_001",
  "order_id": "0x4c2…91",
  "market": "BTC-UPDOWN",
  "side": "UP",
  "price": 0.55,
  "qty": 120,
  "fee": 0.07,
  "pnl": 54.0,
  "timestamp": 1719412800000
}
```

Settlement events (for binaries/parlays):
```json
{
  "type": "SETTLEMENT",
  "market": "BTC-UPDOWN",
  "outcome": "UP",
  "payout": 120.0,
  "timestamp": 1719412800000
}
```

Use case: Agent monitors its fills in real time to update its position model.

## Authentication for MCP Tools

Every tool call is checked against the scoped API key. The sub-wallet associated with the key is the trading identity — all orders, positions, and fills are isolated to that sub-wallet.

To get an API key:
1. Go to the Agents page in the RAETH terminal
2. Click "Generate key"
3. Scope the key to a sub-wallet with a maximum bankroll
4. Pass the key as `Authorization: Bearer rk_test_<key>` in every MCP request

## Rate Limits

- 100 tool calls per second per API key
- `place_order`: max 20 orders/second per key
- `stream_fills`: max 5 concurrent subscriptions per key

## Strategy Templates

### 5m Momentum (`BTC-UPDOWN`)
Agent reads `get_orderbook` every tick, computes 5-minute momentum, places UP/DOWN orders via `place_order`, monitors via `stream_fills`, exits at settlement.

### Perp Market Maker (`BTC-PERP`)
Agent quotes both sides of BTC-PERP via `place_order`, reads positions via `get_positions` to manage inventory, cancels and reprices via `cancel_order` when the market moves.

### Binary/Perp Arb (`MULTI`)
Agent reads both `BTC-UPDOWN` and `BTC-PERP` books, hedges binary exposure with perp position, harvests pricing gaps.
