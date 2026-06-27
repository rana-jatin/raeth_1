import { createServerFn } from "@tanstack/react-start";
import { getDefaultWalletId, getWallet, getFillHistory } from "./exchange/server-state";
import { startSimulator } from "./exchange/ts-simulator";

export interface AgentAnalytics {
  wallet_id: string;
  total_orders: number;
  filled_orders: number;
  cancelled_orders: number;
  cancel_rate: number;
  avg_latency_ms: number;
  sharpe_ratio: number;
  realized_pnl: number;
  bankroll: number;
  pnl_history: { timestamp: number; pnl: number }[];
  recent_fills: {
    fill_id: string;
    market: string;
    side: string;
    price: number;
    qty: number;
    timestamp: number;
  }[];
}

export const getAgentAnalytics = createServerFn({ method: "GET" })
  .handler(async (): Promise<AgentAnalytics> => {
    startSimulator();
    
    const walletId = getDefaultWalletId();
    const wallet = getWallet(walletId);

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    const cancel_rate = wallet.total_orders > 0 
      ? wallet.cancelled_orders / wallet.total_orders 
      : 0;
      
    const avg_latency_ms = wallet.filled_orders > 0 
      ? Math.round(wallet.cumulative_latency_ms / wallet.filled_orders) 
      : 0;

    // Approximate Sharpe Ratio based on PnL history standard deviation
    let sharpe_ratio = 0;
    if (wallet.pnl_history.length > 2) {
      const returns = [];
      for (let i = 1; i < wallet.pnl_history.length; i++) {
        returns.push(wallet.pnl_history[i].pnl - wallet.pnl_history[i - 1].pnl);
      }
      
      const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const squaredDiffs = returns.map(r => Math.pow(r - meanReturn, 2));
      const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (returns.length - 1);
      const stdDev = Math.sqrt(variance);
      
      // Sharpe ratio = Mean Return / Std Dev (ignoring risk-free rate for simplicity)
      sharpe_ratio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0; // Annualized assuming daily periods, just a dummy multiplier here
    }

    const fills = getFillHistory(10).reverse().map(f => ({
      fill_id: f.fill_id,
      market: f.market,
      side: f.side,
      price: f.price,
      qty: f.qty,
      timestamp: f.timestamp,
    }));

    return {
      wallet_id: wallet.wallet_id,
      total_orders: wallet.total_orders,
      filled_orders: wallet.filled_orders,
      cancelled_orders: wallet.cancelled_orders,
      cancel_rate,
      avg_latency_ms,
      sharpe_ratio,
      realized_pnl: wallet.realized_pnl,
      bankroll: wallet.bankroll,
      pnl_history: wallet.pnl_history,
      recent_fills: fills,
    };
  });
