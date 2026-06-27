# RAETH REST API Specification

## Overview

RAETH is an agentic exchange providing REST, WebSocket, and remote MCP interfaces. Base URL: `https://raeth.exchange`. All REST endpoints are under `/v1/`. Authentication is via Bearer token passed as an HTTP header.

## Authentication

All authenticated endpoints require:
```
Authorization: Bearer rk_test_<key>
```

API keys are scoped to a sub-wallet. Each key has a linked bankroll and per-order limits. Keys are generated from the dashboard.

```bash
curl https://raeth.exchange/v1/account \
  -H "Authorization: Bearer rk_test_…"
```

Response:
```json
{
  "wallet_id": "0x9f...c41a",
  "bankroll": "10000.00",
  "currency": "USD",
  "sub_wallet": true
}
```

## Markets

### GET /v1/markets

List all open markets.

Response:
```json
[
  {
    "symbol": "BTC-PERP",
    "name": "BTC Perpetual",
    "kind": "Linear perp · hourly funding",
    "type": "perp",
    "mark": 64931.0,
    "tick": 1.5,
    "vol_24h": "$4.21m",
    "change_24h": "+0.37%"
  },
  {
    "symbol": "BTC-UPDOWN",
    "name": "BTC Up/Down",
    "kind": "5-minute binary",
    "type": "binary",
    "mark": 0.55,
    "tick": 0.005,
    "window": "5m",
    "vol_24h": "$182.4k",
    "change_24h": "+2.4%"
  },
  {
    "symbol": "BTC-UPDOWN-15",
    "name": "BTC Up/Down (15m)",
    "kind": "15-minute binary",
    "type": "binary",
    "mark": 0.48,
    "tick": 0.005,
    "window": "15m",
    "vol_24h": "$96.7k",
    "change_24h": "-1.1%"
  },
  {
    "symbol": "BTC-PARLAY",
    "name": "BTC Parlay 3-leg",
    "kind": "Multi-window parlay",
    "type": "parlay",
    "mark": 0.21,
    "tick": 0.005,
    "window": "3-leg",
    "vol_24h": "$33.9k",
    "change_24h": "+5.8%"
  }
]
```

### GET /v1/markets/:symbol

Get a single market by symbol. Returns the same structure as above but for one market.

### GET /v1/markets/:symbol/orderbook

Get current order book depth.

Query params:
- `levels` (optional, default 10): number of price levels per side

Response:
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
  "timestamp": 1719412800000
}
```

## Orders

### POST /v1/orders

Submit a limit or market order.

Request body:
```json
{
  "market": "BTC-UPDOWN",
  "side": "UP",
  "size": 120,
  "price": "0.55",
  "tif": "GTC"
}
```

Fields:
- `market` (string, required): market symbol (e.g. `BTC-PERP`, `BTC-UPDOWN`, `BTC-UPDOWN-15`, `BTC-PARLAY`)
- `side` (string, required): For perps — `BUY` or `SELL`. For binaries/parlays — `UP` or `DOWN`.
- `size` (number, required): quantity in whole units. Must be > 0.
- `price` (string, optional): limit price as a string decimal. Omit for market orders.
- `tif` (string, optional): time-in-force — `GTC` (good-til-cancelled, default) or `IOC` (immediate-or-cancel).

Response:
```json
{
  "order_id": "0x4c2…91",
  "status": "accepted",
  "market": "BTC-UPDOWN",
  "side": "UP",
  "size": 120,
  "price": "0.55",
  "tif": "GTC",
  "timestamp": 1719412800000
}
```

### GET /v1/orders/:order_id

Get status of an order by ID.

Response:
```json
{
  "order_id": "0x4c2…91",
  "status": "resting",
  "market": "BTC-UPDOWN",
  "side": "UP",
  "size": 120,
  "filled": 0,
  "remaining": 120,
  "price": "0.55",
  "tif": "GTC",
  "created_at": 1719412800000
}
```

Status values:
- `resting` — order is live on the book
- `filled` — order fully matched
- `partially_filled` — partially matched, remainder resting
- `cancelled` — order was cancelled
- `rejected` — order was rejected (see `reject_reason`)

Reject reasons:
- `ZERO_QTY` — size was 0
- `UNKNOWN_ORDER` — cancel referenced an unknown or already-gone order
- `INSUFFICIENT_BALANCE` — insufficient bankroll
- `PRICE_BAND` — price outside allowed band

### DELETE /v1/orders/:order_id

Cancel a resting order.

Response:
```json
{
  "order_id": "0x4c2…91",
  "status": "cancelled",
  "remaining": 120
}
```

### GET /v1/orders

List your open orders.

Query params:
- `market` (optional): filter by market symbol
- `status` (optional): filter by status (`resting`, `filled`, `cancelled`)

## Positions

### GET /v1/positions

Get current positions.

Response:
```json
[
  {
    "market": "BTC-PERP",
    "side": "LONG",
    "size": 0.5,
    "entry_price": 64800.0,
    "mark_price": 64931.0,
    "pnl": 65.5,
    "pnl_pct": "+0.10%",
    "margin": 324.0,
    "liquidation_price": 62000.0
  }
]
```

## Fills

### GET /v1/fills

Get fill history.

Query params:
- `market` (optional): filter by market
- `limit` (optional, default 50, max 500): number of fills to return

Response:
```json
[
  {
    "fill_id": "f_001",
    "order_id": "0x4c2…91",
    "market": "BTC-UPDOWN",
    "side": "UP",
    "price": "0.55",
    "qty": 120,
    "fee": "0.07",
    "timestamp": 1719412800000
  }
]
```

## Account

### GET /v1/account

Get account info.

Response:
```json
{
  "wallet_id": "0x9f...c41a",
  "bankroll": "10000.00",
  "available": "9676.00",
  "margin_used": "324.00",
  "realized_pnl": "54.00",
  "currency": "USD"
}
```

## Error Responses

All errors follow this shape:
```json
{
  "error": "INSUFFICIENT_BALANCE",
  "message": "Available balance 12.00 is less than required margin 324.00",
  "code": 400
}
```

Common HTTP status codes:
- `400` — bad request (validation error, reject reason)
- `401` — missing or invalid API key
- `403` — key doesn't have permission for this action
- `404` — order or market not found
- `429` — rate limited (100 req/s per key)
- `500` — internal server error
