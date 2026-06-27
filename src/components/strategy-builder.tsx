/**
 * Natural-Language Strategy Builder (#4).
 *
 * Type an instruction → the LLM compiles it into a scoped StrategySpec → preview
 * + Risk Firewall pre-check → Arm (runs it as an arena bot) → kill switch. The
 * armed strategy is a risk-bounded instance of a known bot, so it is fully
 * inspectable in the Arena leaderboard and thought stream.
 */

import { useState } from "react";
import { Sparkles, ShieldCheck, ShieldAlert, Rocket, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { parseStrategy } from "@/lib/nl-strategy";
import { createBotState } from "@/lib/agents/presets";
import { STRATEGY_META } from "@/lib/agents/presets";
import { evaluateRisk } from "@/lib/agents/risk";
import type { StrategySpec } from "@/lib/agents/strategy-schema";
import type { DecisionDraft, RiskVerdict, Side } from "@/lib/agents/types";
import type { MarketConfig } from "@/lib/markets";

const EXAMPLES = [
  "Buy BTC-PERP if price breaks above EMA and risk only 2%",
  "Make markets on BTC-PERP, earn the spread, max 3x leverage",
  "Fade BTC Up/Down when RSI gets extreme, risk 1.5%",
  "Trade the news on BTC-PERP, react to volatility spikes, risk 5%",
];

function precheck(spec: StrategySpec, market: MarketConfig): RiskVerdict {
  const limits = {
    ...STRATEGY_META[spec.kind].limits,
    riskPct: spec.riskPct,
    maxLeverage: spec.maxLeverage,
  };
  const tempBot = createBotState(spec.kind, market, {
    name: spec.name ?? `NL ${spec.kind}`,
    limits,
  });
  const side: Side = spec.side === "SELL" ? "SELL" : "BUY";
  const repQty = market.type === "perp" ? 0.3 : 80;
  const draft: DecisionDraft = {
    frameId: 0,
    side,
    px: market.base,
    qty: repQty,
    conviction: 0.7,
    monologue: "",
    triggers: [],
    expectedPnl: 0,
    tif: "GTC",
  };
  return evaluateRisk(draft, tempBot);
}

export function StrategyBuilder({
  market,
  onArm,
}: {
  market: MarketConfig;
  onArm: (spec: StrategySpec) => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [spec, setSpec] = useState<StrategySpec | null>(null);
  const [summary, setSummary] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const verdict = spec ? precheck(spec, market) : null;

  const parse = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setSpec(null);
    try {
      const res = await parseStrategy({ data: { text } });
      if (res.error || !res.spec) {
        setError(res.error ?? "Could not parse a strategy.");
        setWarnings(res.warnings);
      } else {
        setSpec(res.spec);
        setSummary(res.summary);
        setWarnings(res.warnings);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const arm = () => {
    if (!spec || !verdict?.allow) return;
    onArm(spec);
    toast.success(`Armed ${spec.name ?? spec.kind} on ${spec.market}`, {
      description: `≤${(spec.riskPct * 100).toFixed(1)}% bankroll · ${spec.maxLeverage}× · firewall active`,
    });
    setSpec(null);
    setText("");
  };

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center gap-2 px-1">
        <Sparkles className="h-4 w-4 text-accent" />
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Natural-language strategy
        </p>
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='e.g. "Buy BTC-PERP if price breaks above EMA and risk only 2%"'
        className="mt-2 h-20 resize-none font-mono text-[12px]"
      />

      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setText(ex)}
            className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-accent/40 hover:text-foreground"
          >
            {ex.length > 38 ? `${ex.slice(0, 38)}…` : ex}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={parse}
          disabled={loading || !text.trim()}
          className="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 font-mono text-xs font-medium hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {loading ? "Compiling…" : "Compile strategy"}
        </button>
        <span className="font-mono text-[10px] text-muted-foreground">
          scoped · risk-checked · kill-switch in leaderboard
        </span>
      </div>

      {error && (
        <p className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 font-mono text-[11px] text-destructive">
          {error}
        </p>
      )}

      {spec && verdict && (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-background/50 p-3 font-mono text-[11px]">
          <p className="text-foreground/90">{summary}</p>

          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Field k="Strategy" v={STRATEGY_META[spec.kind].label} />
            <Field k="Market" v={spec.market} />
            <Field k="Risk" v={`≤${(spec.riskPct * 100).toFixed(1)}%`} />
            <Field k="Max leverage" v={`${spec.maxLeverage}×`} />
          </div>
          {spec.exit && <Field k="Exit" v={spec.exit} />}
          {spec.killSwitch && <Field k="Kill switch" v={spec.killSwitch} />}

          {warnings.length > 0 && (
            <ul className="text-yellow-400">
              {warnings.map((w, i) => (
                <li key={i}>▲ {w}</li>
              ))}
            </ul>
          )}

          <div
            className={`flex items-center gap-1.5 ${verdict.allow ? "text-live" : "text-destructive"}`}
          >
            {verdict.allow ? (
              <ShieldCheck className="h-3.5 w-3.5" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            {verdict.allow
              ? `Risk pre-check passed — max loss $${verdict.maxLossUsd.toFixed(0)} / trade, ${verdict.leverage.toFixed(2)}× on a sample order.`
              : `Blocked: ${verdict.alerts.find((a) => a.severity === "block")?.message ?? "risk limit"}`}
          </div>

          <button
            type="button"
            onClick={arm}
            disabled={!verdict.allow}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary py-2 font-mono text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Rocket className="h-3.5 w-3.5" /> Arm strategy
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded border border-border bg-background/60 px-2 py-1">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  );
}
