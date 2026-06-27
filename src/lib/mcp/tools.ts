/**
 * Read-only MCP tools that expose live simulated exchange state to the LLM.
 *
 * These tools read from server-state.ts (real simulated data). They are passed
 * to Groq as tool definitions so the LLM can decide when to call them.
 *
 * IMPORTANT: All tools are READ-ONLY. The support bot cannot place or cancel
 * orders. It can only inspect the current exchange state.
 */

import type { ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import {
  getAllMarketSnapshots,
  getMarketSnapshot,
  getOrder,
  getWallet,
  getAllPositions,
  getRestingOrders,
  getFillHistory,
  getDefaultWalletId,
  type MarketSymbol,
} from "@/lib/exchange/server-state";

// ─── Tool definitions (Groq format) ──────────────────────────────────────────

export const MCP_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_order_status",
      description:
        "Get the current status of an order by its order ID. Returns side, price, quantity, filled amount, and status (resting/filled/cancelled/rejected).",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID returned when the order was submitted, e.g. 'ord_000001'",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_subwallet_balance",
      description:
        "Check the current sub-wallet balance including total bankroll, available funds, margin in use, and realized PnL.",
      parameters: {
        type: "object",
        properties: {
          wallet_id: {
            type: "string",
            description: "The sub-wallet ID. Leave empty to use the default sub-wallet.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_market_snapshot",
      description:
        "Get the current market state including mid price, best bid/ask, spread, 24h volume, and change. For binaries, also returns remaining window time.",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            enum: ["BTC-PERP", "BTC-UPDOWN", "BTC-UPDOWN-15", "BTC-PARLAY"],
            description: "Market symbol",
          },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_orderbook_depth",
      description:
        "Get the current order book depth (bids and asks) for a market, up to the specified number of levels.",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            enum: ["BTC-PERP", "BTC-UPDOWN", "BTC-UPDOWN-15", "BTC-PARLAY"],
            description: "Market symbol",
          },
          levels: {
            type: "number",
            description: "Number of price levels per side to return (default 5, max 10)",
          },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_funding_rate",
      description:
        "Get the current funding rate for BTC-PERP (percentage per hour). Only applicable to the perpetual market.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_open_markets",
      description:
        "List all open markets with their current marks, 24h volume, and status.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_resting_orders",
      description:
        "List all currently resting (live) orders in the simulated order book across all markets.",
      parameters: {
        type: "object",
        properties: {
          market: {
            type: "string",
            enum: ["BTC-PERP", "BTC-UPDOWN", "BTC-UPDOWN-15", "BTC-PARLAY"],
            description: "Filter by market symbol (optional)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_fill_history",
      description:
        "Get the recent fill history (last N fills) for the exchange, showing matched trades.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of fills to return (default 10, max 50)",
          },
        },
        required: [],
      },
    },
  },
];

// ─── Tool implementation ──────────────────────────────────────────────────────

export type ToolResult = { success: true; data: unknown } | { success: false; error: string };

export function executeTool(name: string, args: Record<string, unknown>): ToolResult {
  try {
    switch (name) {
      case "get_order_status": {
        const order_id = String(args.order_id ?? "");
        const order = getOrder(order_id);
        if (!order) return { success: false, error: `Order '${order_id}' not found. It may not exist or was never submitted to this session.` };
        return { success: true, data: order };
      }

      case "check_subwallet_balance": {
        const wallet_id = args.wallet_id ? String(args.wallet_id) : getDefaultWalletId();
        const wallet = getWallet(wallet_id);
        if (!wallet) return { success: false, error: `Wallet '${wallet_id}' not found.` };
        return { success: true, data: wallet };
      }

      case "get_market_snapshot": {
        const symbol = String(args.symbol ?? "") as MarketSymbol;
        const snap = getMarketSnapshot(symbol);
        if (!snap) return { success: false, error: `Market '${symbol}' not found.` };
        return {
          success: true,
          data: {
            symbol: snap.symbol,
            mid: snap.mid.toFixed(symbol === "BTC-PERP" ? 1 : 4),
            best_bid: snap.bids[0]?.price.toFixed(symbol === "BTC-PERP" ? 1 : 4),
            best_ask: snap.asks[0]?.price.toFixed(symbol === "BTC-PERP" ? 1 : 4),
            spread: snap.spread,
            vol_24h: snap.vol_24h,
            change_24h_pct: snap.change_24h.toFixed(2) + "%",
            funding_rate: snap.funding_rate ? (snap.funding_rate * 100).toFixed(4) + "% / hr" : undefined,
            window_remaining: snap.window_remaining_ms
              ? `${Math.ceil(snap.window_remaining_ms / 1000)}s`
              : undefined,
          },
        };
      }

      case "get_orderbook_depth": {
        const symbol = String(args.symbol ?? "") as MarketSymbol;
        const levels = Math.min(10, Math.max(1, Number(args.levels ?? 5)));
        const snap = getMarketSnapshot(symbol);
        if (!snap) return { success: false, error: `Market '${symbol}' not found.` };
        return {
          success: true,
          data: {
            symbol,
            bids: snap.bids.slice(0, levels),
            asks: snap.asks.slice(0, levels),
            mid: snap.mid,
            spread: snap.spread,
            timestamp: Date.now(),
          },
        };
      }

      case "get_funding_rate": {
        const snap = getMarketSnapshot("BTC-PERP");
        return {
          success: true,
          data: {
            symbol: "BTC-PERP",
            funding_rate_pct_per_hour: snap?.funding_rate != null
              ? (snap.funding_rate * 100).toFixed(4) + "%"
              : "0.0010%",
            next_funding_in: "< 1 hour",
            note: "Positive rate means longs pay shorts.",
          },
        };
      }

      case "list_open_markets": {
        const markets = getAllMarketSnapshots();
        return {
          success: true,
          data: markets.map((m) => ({
            symbol:       m.symbol,
            mid:          m.mid,
            change_24h:   m.change_24h.toFixed(2) + "%",
            vol_24h:      m.vol_24h,
            best_bid:     m.bids[0]?.price,
            best_ask:     m.asks[0]?.price,
            window_remaining: m.window_remaining_ms
              ? `${Math.ceil(m.window_remaining_ms / 1000)}s`
              : undefined,
          })),
        };
      }

      case "get_resting_orders": {
        const market = args.market ? String(args.market) as MarketSymbol : undefined;
        let orders = getRestingOrders();
        if (market) orders = orders.filter((o) => o.market === market);
        return {
          success: true,
          data: {
            count: orders.length,
            orders: orders.slice(0, 20), // cap at 20 to avoid bloating the context
          },
        };
      }

      case "get_fill_history": {
        const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10)));
        const fills = getFillHistory(limit);
        return { success: true, data: { count: fills.length, fills } };
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { success: false, error: `Tool execution error: ${String(err)}` };
  }
}
