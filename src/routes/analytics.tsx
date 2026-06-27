import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell } from "../components/site-chrome";
import { getRequestOrigin } from "../lib/origin.functions";
import { getAgentAnalytics, type AgentAnalytics } from "../lib/analytics-api";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid
} from "recharts";

export const Route = createFileRoute("/analytics")({
  loader: async () => ({ origin: await getRequestOrigin() }),
  head: () => ({
    meta: [
      { title: "Agent Analytics — RAETH Agentic Exchange" },
      {
        name: "description",
        content: "Track agent performance metrics: latency, cancel rates, and Sharpe ratio.",
      },
    ],
    links: [{ rel: "canonical", href: "/analytics" }],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const [data, setData] = useState<AgentAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Poll the analytics endpoint every 2 seconds to match simulator tick
    const fetchAnalytics = async () => {
      try {
        const result = await getAgentAnalytics();
        setData(result);
      } catch (err) {
        setError(String(err));
      }
    };

    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <PageShell>
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
          RAETH / Analytics
        </p>
        <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight">
          Agent Observability
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          Monitor your autonomous agent's performance in real-time. Track order latency, cancel rates, and simulated Sharpe ratio.
        </p>
      </section>

      {error ? (
        <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-destructive font-mono text-sm">
          Error loading analytics: {error}
        </div>
      ) : !data ? (
        <div className="mt-8 flex items-center gap-2 font-mono text-sm text-muted-foreground">
          <SpinIcon /> Loading agent metrics...
        </div>
      ) : (
        <div className="mt-10 space-y-8">
          {/* Key Metrics */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Realized PnL"
              value={`$${data.realized_pnl.toFixed(2)}`}
              trend={data.realized_pnl >= 0 ? "positive" : "negative"}
            />
            <MetricCard
              label="Cancel Rate"
              value={`${(data.cancel_rate * 100).toFixed(1)}%`}
              subtitle={`${data.cancelled_orders} / ${data.total_orders} orders`}
            />
            <MetricCard
              label="Avg Latency"
              value={`${data.avg_latency_ms} ms`}
              subtitle="time to fill"
            />
            <MetricCard
              label="Sharpe Ratio"
              value={data.sharpe_ratio.toFixed(2)}
              trend={data.sharpe_ratio >= 1 ? "positive" : (data.sharpe_ratio > 0 ? "neutral" : "negative")}
            />
          </div>

          {/* PnL Chart */}
          <div className="rounded-lg border border-border bg-card/50 p-6">
            <h3 className="font-semibold mb-6">PnL History</h3>
            <div className="h-[300px] w-full">
              {data.pnl_history.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.pnl_history.map(d => ({ ...d, time: new Date(d.timestamp).toLocaleTimeString() }))}>
                    <defs>
                      <linearGradient id="pnlColor" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis 
                      dataKey="time" 
                      stroke="#888" 
                      fontSize={11} 
                      tickLine={false} 
                      axisLine={false} 
                      minTickGap={30}
                    />
                    <YAxis 
                      stroke="#888" 
                      fontSize={11} 
                      tickLine={false} 
                      axisLine={false} 
                      tickFormatter={(val) => `$${val}`}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '6px' }}
                      itemStyle={{ color: '#22c55e' }}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, 'PnL']}
                    />
                    <Area 
                      type="stepAfter" 
                      dataKey="pnl" 
                      stroke="#22c55e" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#pnlColor)" 
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Not enough data to plot PnL. Waiting for trades to settle...
                </div>
              )}
            </div>
          </div>

          {/* Recent Fills */}
          <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
            <div className="p-6 border-b border-border">
              <h3 className="font-semibold">Recent Fills</h3>
            </div>
            {data.recent_fills.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-[13px]">
                  <thead className="bg-secondary/50 text-muted-foreground">
                    <tr>
                      <th className="px-6 py-3 font-medium">Time</th>
                      <th className="px-6 py-3 font-medium">Market</th>
                      <th className="px-6 py-3 font-medium">Side</th>
                      <th className="px-6 py-3 font-medium text-right">Price</th>
                      <th className="px-6 py-3 font-medium text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {data.recent_fills.map((fill) => (
                      <tr key={fill.fill_id} className="hover:bg-accent/5">
                        <td className="px-6 py-3 text-muted-foreground">
                          {new Date(fill.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-6 py-3 text-accent">{fill.market}</td>
                        <td className={`px-6 py-3 ${fill.side === 'BUY' || fill.side === 'UP' ? 'text-green-500' : 'text-red-500'}`}>
                          {fill.side}
                        </td>
                        <td className="px-6 py-3 text-right">${fill.price.toFixed(fill.market === 'BTC-PERP' ? 2 : 4)}</td>
                        <td className="px-6 py-3 text-right">{fill.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-sm text-muted-foreground">No recent fills found.</div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}

function MetricCard({ label, value, subtitle, trend }: { label: string; value: string; subtitle?: string; trend?: "positive" | "negative" | "neutral" }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-5 transition-colors hover:border-accent/40">
      <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <div className="mt-3 flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tracking-tight ${trend === 'positive' ? 'text-green-500' : trend === 'negative' ? 'text-red-500' : 'text-foreground'}`}>
          {value}
        </span>
      </div>
      {subtitle && <p className="mt-1 font-mono text-[10px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function SpinIcon() {
  return (
    <svg className="h-4 w-4 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}
