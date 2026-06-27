import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Plus, Trash2, Trophy, Bot as BotIcon } from "lucide-react";
import { PageShell } from "../components/site-chrome";
import { RiskFirewall } from "../components/risk-firewall";
import { StrategyBuilder } from "../components/strategy-builder";
import { getRequestOrigin } from "../lib/origin.functions";
import { MARKETS, getMarket, normalizeSymbol } from "../lib/markets";
import { useArena } from "../lib/agents/runner";
import { STRATEGY_KINDS, STRATEGY_META } from "../lib/agents/presets";
import type { BotState, StrategyKind } from "../lib/agents/types";
import type { StrategySpec } from "../lib/agents/strategy-schema";

export const Route = createFileRoute("/arena")({
  validateSearch: (search: Record<string, unknown>): { symbol: string } => ({
    symbol: normalizeSymbol(search.symbol),
  }),
  loader: async () => ({ origin: await getRequestOrigin() }),
  head: () => ({
    meta: [
      { title: "Strategy Arena — RAETH Agentic Exchange" },
      {
        name: "description",
        content:
          "Launch momentum, mean-reversion, market-maker, news-reactive, and arbitrage bots on a live order book and rank them by PnL, drawdown, win rate, latency, and risk score.",
      },
      { property: "og:title", content: "Strategy Arena — RAETH" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/arena" },
    ],
    links: [{ rel: "canonical", href: "/arena" }],
  }),
  component: ArenaPage,
});

function totalPnl(b: BotState): number {
  return b.metrics.realizedPnl + b.metrics.unrealizedPnl;
}

function ArenaPage() {
  const { symbol } = Route.useSearch();
  const market = getMarket(symbol);
  const arena = useArena(market, STRATEGY_KINDS);
  const { bots, decisions, mark, ready, setPaused, addBot, removeBot } = arena;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [launchKind, setLaunchKind] = useState<StrategyKind>("momentum");

  const ranked = useMemo(() => [...bots].sort((a, b) => totalPnl(b) - totalPnl(a)), [bots]);
  const selected = bots.find((b) => b.id === selectedId) ?? ranked[0] ?? null;
  const selectedDecisions = useMemo(
    () => (selected ? decisions.filter((d) => d.botId === selected.id).slice(0, 12) : []),
    [decisions, selected],
  );

  const armSpec = (spec: StrategySpec) => {
    const id = addBot(spec.kind, {
      name: spec.name ?? `NL ${STRATEGY_META[spec.kind].label}`,
      limits: {
        ...STRATEGY_META[spec.kind].limits,
        riskPct: spec.riskPct,
        maxLeverage: spec.maxLeverage,
      },
    });
    setSelectedId(id);
  };

  return (
    <PageShell>
      <section className="mt-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
          RAETH / Arena
        </p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold leading-[1.1] tracking-tight">
              Agent Strategy Arena
            </h1>
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
              Five strategies trade the same {market.symbol} book in real time. Watch them compete,
              inspect every decision, and rank them on PnL, drawdown, win rate, latency, and risk.
            </p>
          </div>
          <MarketPicker active={market.symbol} />
        </div>
      </section>

      {/* Launch controls */}
      <section className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/50 p-3">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Launch bot
        </span>
        <select
          value={launchKind}
          onChange={(e) => setLaunchKind(e.target.value as StrategyKind)}
          className="rounded border border-border bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {STRATEGY_KINDS.map((k) => (
            <option key={k} value={k}>
              {STRATEGY_META[k].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSelectedId(addBot(launchKind))}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> Launch
        </button>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <span
            className={`h-1.5 w-1.5 rounded-full ${ready ? "animate-pulse bg-live" : "bg-muted-foreground"}`}
          />
          {ready
            ? `${bots.length} bots live · simulated, no real orders`
            : "spinning up matching engine…"}
        </span>
      </section>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        {/* Leaderboard */}
        <div className="overflow-hidden rounded-lg border border-border bg-card/50">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Trophy className="h-4 w-4 text-accent" />
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Leaderboard
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[12px] tabular-nums">
              <thead className="bg-secondary/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Bot</th>
                  <th className="px-3 py-2 text-right font-medium">PnL</th>
                  <th className="px-3 py-2 text-right font-medium">Drawdown</th>
                  <th className="px-3 py-2 text-right font-medium">Win</th>
                  <th className="px-3 py-2 text-right font-medium">Lat</th>
                  <th className="px-3 py-2 text-right font-medium">Risk</th>
                  <th className="px-3 py-2 text-right font-medium">PnL curve</th>
                  <th className="px-3 py-2 text-right font-medium"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {ranked.map((b, i) => {
                  const pnl = totalPnl(b);
                  const isSel = selected?.id === b.id;
                  return (
                    <tr
                      key={b.id}
                      onClick={() => setSelectedId(b.id)}
                      className={`cursor-pointer transition-colors hover:bg-accent/5 ${isSel ? "bg-accent/10" : ""} ${b.paused ? "opacity-50" : ""}`}
                    >
                      <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-foreground">{b.name}</span>
                          {b.paused && (
                            <span className="rounded bg-secondary px-1 text-[9px] uppercase text-muted-foreground">
                              paused
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {STRATEGY_META[b.kind].label}
                        </span>
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${pnl >= 0 ? "text-live" : "text-destructive"}`}
                      >
                        {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        ${b.metrics.maxDrawdown.toFixed(0)}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {(b.metrics.winRate * 100).toFixed(0)}%
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {b.metrics.avgLatencyMs}ms
                      </td>
                      <td
                        className={`px-3 py-2 text-right ${b.metrics.riskScore >= 70 ? "text-destructive" : b.metrics.riskScore >= 40 ? "text-yellow-400" : "text-live"}`}
                      >
                        {b.metrics.riskScore}
                      </td>
                      <td className="px-3 py-2">
                        <div className="ml-auto h-7 w-24">
                          <Sparkline data={b.pnlHistory} positive={pnl >= 0} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeBot(b.id);
                          }}
                          className="rounded border border-border p-1 text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                          aria-label="Remove bot"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {ranked.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                      No bots running — launch one above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* NL strategy builder + selected-bot risk firewall */}
        <div className="flex flex-col gap-3">
          <StrategyBuilder market={market} onArm={armSpec} />
          {selected ? (
            <RiskFirewall
              bot={selected}
              mark={mark}
              onTogglePause={(p) => setPaused(selected.id, p)}
            />
          ) : (
            <div className="rounded-lg border border-border bg-card/50 p-6 text-center font-mono text-xs text-muted-foreground">
              Select a bot to inspect its risk firewall.
            </div>
          )}
        </div>
      </div>

      {/* Glass-box decision feed for the selected bot */}
      <section className="mt-3 rounded-lg border border-border bg-card/50 p-3">
        <div className="flex items-center gap-2 px-1">
          <BotIcon className="h-4 w-4 text-accent" />
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {selected ? `${selected.name} · thought stream` : "Thought stream"}
          </p>
        </div>
        {selectedDecisions.length === 0 ? (
          <p className="py-8 text-center font-mono text-[11px] text-muted-foreground">
            waiting for an edge…
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border/50 font-mono text-[11px]">
            {selectedDecisions.map((d) => {
              const pnlTone =
                d.actualPnl === null
                  ? "text-muted-foreground"
                  : d.actualPnl >= 0
                    ? "text-live"
                    : "text-destructive";
              return (
                <li
                  key={d.id}
                  className="grid grid-cols-[50px_1fr_120px_70px] items-center gap-2 px-1 py-2 tabular-nums"
                >
                  <span className={d.side === "BUY" ? "text-live" : "text-destructive"}>
                    {d.side} {d.qty}
                  </span>
                  <span className="truncate text-foreground/80">{d.monologue}</span>
                  <span className="text-right text-muted-foreground">
                    risk {d.riskLimit} · conv {(d.conviction * 100).toFixed(0)}%
                  </span>
                  <span className={`text-right ${pnlTone}`}>
                    {d.actualPnl === null
                      ? `~$${d.expectedPnl.toFixed(0)}`
                      : `${d.actualPnl >= 0 ? "+" : ""}$${d.actualPnl.toFixed(0)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageShell>
  );
}

function MarketPicker({ active }: { active: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MARKETS.map((m) => (
        <Link
          key={m.symbol}
          to="/arena"
          search={{ symbol: m.symbol }}
          className={`rounded-md border px-3 py-1.5 font-mono text-[11px] transition-colors ${
            m.symbol === active
              ? "border-accent/60 bg-accent/10 text-foreground"
              : "border-border text-muted-foreground hover:border-accent/40 hover:text-foreground"
          }`}
        >
          {m.symbol}
        </Link>
      ))}
    </div>
  );
}

function Sparkline({ data, positive }: { data: { t: number; pnl: number }[]; positive: boolean }) {
  if (data.length < 2) return <div className="h-full w-full" />;
  const color = positive ? "oklch(0.78 0.16 152)" : "oklch(0.65 0.22 25)";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <defs>
          <linearGradient id={`spark-${positive ? "up" : "dn"}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="pnl"
          stroke={color}
          strokeWidth={1.2}
          fill={`url(#spark-${positive ? "up" : "dn"})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
