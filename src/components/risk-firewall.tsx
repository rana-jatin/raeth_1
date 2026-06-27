/**
 * Agent Risk Firewall panel (#5).
 *
 * Shows a bot's pre-trade risk envelope (max loss, leverage, notional, risk
 * score), its live behavioral alerts (overtrading, repeated failed trades,
 * drawdown, churn), and a pause/resume switch. Shared by the trade terminal
 * (single agent) and the Strategy Arena (per bot). Orders that trip a "block"
 * alert never reach the book — the runner enforces this via evaluateRisk.
 */

import { ShieldAlert, ShieldCheck, ShieldX, Pause, Play } from "lucide-react";
import { behavioralAlerts } from "@/lib/agents/risk";
import { ordersInWindow } from "@/lib/agents/metrics";
import type { BotState, RiskAlert, RiskVerdict } from "@/lib/agents/types";

const SEV_ORDER: Record<RiskAlert["severity"], number> = { block: 0, warn: 1, info: 2 };
const SEV_COLOR: Record<RiskAlert["severity"], string> = {
  block: "text-destructive",
  warn: "text-yellow-400",
  info: "text-muted-foreground",
};

function mergeAlerts(a: RiskAlert[], b: RiskAlert[]): RiskAlert[] {
  const seen = new Set<string>();
  const out: RiskAlert[] = [];
  for (const alert of [...a, ...b]) {
    const key = `${alert.kind}:${alert.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alert);
  }
  return out.sort((x, y) => SEV_ORDER[x.severity] - SEV_ORDER[y.severity]);
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${tone ?? "text-foreground"}`}>{value}</span>
    </div>
  );
}

export function RiskFirewall({
  bot,
  mark,
  verdict,
  onTogglePause,
}: {
  bot: BotState;
  mark: number;
  verdict?: RiskVerdict | null;
  onTogglePause?: (paused: boolean) => void;
}) {
  const maxLoss = bot.bankroll * bot.limits.riskPct;
  const notional = Math.abs(bot.position) * mark;
  const leverage = notional / Math.max(1, bot.bankroll);
  const riskScore = bot.metrics.riskScore;
  const alerts = mergeAlerts(behavioralAlerts(bot), verdict?.alerts ?? []);
  const worst = alerts[0]?.severity;
  const ordersWin = ordersInWindow(bot);

  const Shield = bot.paused
    ? ShieldX
    : worst === "block"
      ? ShieldAlert
      : worst === "warn"
        ? ShieldAlert
        : ShieldCheck;
  const shieldColor = bot.paused
    ? "text-muted-foreground"
    : worst === "block"
      ? "text-destructive"
      : worst === "warn"
        ? "text-yellow-400"
        : "text-live";

  const scoreTone =
    riskScore >= 70 ? "text-destructive" : riskScore >= 40 ? "text-yellow-400" : "text-live";

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 font-mono">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Shield className={`h-4 w-4 ${shieldColor}`} />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Risk firewall · {bot.name}
          </span>
        </div>
        {onTogglePause && (
          <button
            type="button"
            onClick={() => onTogglePause(!bot.paused)}
            className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide transition-colors ${
              bot.paused
                ? "border-live/40 bg-live/10 text-live hover:bg-live/20"
                : "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
            }`}
          >
            {bot.paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {bot.paused ? "Resume" : "Pause agent"}
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 border-y border-border/60 py-2 text-[11px]">
        <Stat label="Max loss" value={`$${maxLoss.toFixed(0)}`} tone="text-destructive" />
        <Stat
          label="Leverage"
          value={`${leverage.toFixed(2)}×`}
          tone={leverage > bot.limits.maxLeverage ? "text-destructive" : "text-foreground"}
        />
        <Stat label="Notional" value={`$${notional.toFixed(0)}`} />
        <Stat label="Risk score" value={`${riskScore}`} tone={scoreTone} />
      </div>

      <div className="mt-2 grid grid-cols-4 gap-2 px-1 text-[10px] text-muted-foreground">
        <span>
          orders {ordersWin}/{bot.limits.maxOrdersPerWindow}
        </span>
        <span>rejects {bot.counters.consecutiveRejects}</span>
        <span>blocked {bot.counters.blockedCount}</span>
        <span>flips {bot.counters.flipFlops}</span>
      </div>

      <ul className="mt-2 space-y-1 px-1 text-[11px]">
        {alerts.length === 0 ? (
          <li className="text-live">✓ within limits — clear to trade</li>
        ) : (
          alerts.map((a, i) => (
            <li
              key={`${a.kind}-${i}`}
              className={`flex items-start gap-1.5 ${SEV_COLOR[a.severity]}`}
            >
              <span>{a.severity === "block" ? "■" : a.severity === "warn" ? "▲" : "•"}</span>
              <span>{a.message}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
