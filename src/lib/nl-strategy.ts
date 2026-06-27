/**
 * Natural-Language Trading (#4) — /api server function.
 *
 * Takes a plain-English instruction ("Buy BTC-PERP if price breaks above EMA
 * and risk only 2%") and converts it into a scoped, zod-validated StrategySpec
 * via Groq (same client + model the support bot uses). The spec maps the intent
 * to the closest built-in strategy plus a bounded risk envelope — it is then
 * previewed, risk-checked, and (if armed) run as a normal arena bot.
 *
 * Mirrors the createServerFn pattern in lib/support-chat.ts.
 */

import { createServerFn } from "@tanstack/react-start";
import Groq from "groq-sdk";
import {
  StrategySpecSchema,
  STRATEGY_KIND_VALUES,
  MARKET_VALUES,
  type StrategySpec,
} from "@/lib/agents/strategy-schema";

export interface ParseStrategyResponse {
  spec: StrategySpec | null;
  summary: string;
  warnings: string[];
  model: string;
  error?: string;
}

function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY environment variable is not set.");
  return new Groq({ apiKey });
}

const SYSTEM_PROMPT = `You are RAETH's strategy compiler. Convert a trader's plain-English instruction into a single JSON object describing a scoped, risk-bounded trading strategy.

Available strategy kinds (pick the closest match to the user's intent):
- "momentum": ride short-window trend; use for "breakout", "follow the trend", "buy strength".
- "mean_reversion": fade stretched moves back to the average; use for "buy dips", "fade", "revert".
- "market_maker": quote both sides and earn the spread; use for "make markets", "provide liquidity", "earn spread".
- "news_reactive": react to volatility spikes; use for "trade the news", "react to headlines", "momentum on spikes".
- "arbitrage": capture order-book mispricing; use for "arb", "capture the gap", "microprice".

Available markets: ${MARKET_VALUES.join(", ")}. Default to BTC-PERP if unspecified.

Output ONLY a JSON object with exactly these fields:
{
  "kind": one of ${JSON.stringify(STRATEGY_KIND_VALUES)},
  "market": one of ${JSON.stringify(MARKET_VALUES)},
  "side": "BUY" | "SELL" | "AUTO"   // AUTO lets the strategy choose direction,
  "riskPct": number,                 // fraction of bankroll per trade, e.g. 0.02 for "risk 2%"
  "maxLeverage": number,             // 1..25, default 5
  "entry": string,                   // short human-readable entry condition
  "exit": string | null,             // optional exit condition
  "killSwitch": string | null,       // optional condition to halt the agent
  "name": string | null              // optional short label
}

Rules:
- "risk only 2%" → riskPct 0.02. "risk 5%" → 0.05. If no risk stated, use 0.02.
- If a direction is explicit ("buy"/"long" → BUY, "sell"/"short" → DOWN/SELL), set side; otherwise AUTO.
- Keep entry/exit concise (one clause each). Do not invent leverage above 25.
- Return strictly the JSON object, no prose, no markdown fences.`;

function clampNumber(
  v: unknown,
  lo: number,
  hi: number,
  fallback: number,
): { value: number; clamped: boolean } {
  const n = typeof v === "number" && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return { value: fallback, clamped: true };
  const clamped = Math.min(hi, Math.max(lo, n));
  return { value: clamped, clamped: clamped !== n };
}

function summarize(spec: StrategySpec): string {
  const sideTxt = spec.side === "AUTO" ? "auto-direction" : spec.side;
  return `${spec.name ?? spec.kind} → ${spec.kind.replace("_", " ")} on ${spec.market}, ${sideTxt}, ≤${(spec.riskPct * 100).toFixed(1)}% bankroll · ${spec.maxLeverage}× max. Entry: ${spec.entry}.`;
}

export const parseStrategy = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { text: string })
  .handler(async (ctx): Promise<ParseStrategyResponse> => {
    const text = (ctx.data?.text ?? "").trim();
    const model = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
    if (!text) {
      return { spec: null, summary: "", warnings: ["Empty instruction."], model, error: "empty" };
    }

    let raw: Record<string, unknown>;
    try {
      const groq = getGroqClient();
      const completion = await groq.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 512,
      });
      const content = completion.choices[0]?.message?.content ?? "{}";
      raw = JSON.parse(content) as Record<string, unknown>;
    } catch (err) {
      return { spec: null, summary: "", warnings: [], model, error: `LLM error: ${String(err)}` };
    }

    // Normalize + clamp before validating, collecting warnings.
    const warnings: string[] = [];
    const kind = STRATEGY_KIND_VALUES.includes(raw.kind as never) ? raw.kind : "momentum";
    if (kind !== raw.kind) warnings.push(`Unrecognized strategy kind — defaulted to momentum.`);
    const mkt = MARKET_VALUES.includes(raw.market as never) ? raw.market : "BTC-PERP";
    if (mkt !== raw.market) warnings.push(`Unrecognized market — defaulted to BTC-PERP.`);
    const side = ["BUY", "SELL", "AUTO"].includes(raw.side as string) ? raw.side : "AUTO";
    const risk = clampNumber(raw.riskPct, 0.001, 0.5, 0.02);
    if (risk.clamped) warnings.push(`riskPct clamped to ${(risk.value * 100).toFixed(1)}%.`);
    const lev = clampNumber(raw.maxLeverage, 1, 25, 5);
    if (lev.clamped) warnings.push(`maxLeverage clamped to ${lev.value}×.`);

    const candidate = {
      kind,
      market: mkt,
      side,
      riskPct: risk.value,
      maxLeverage: lev.value,
      entry: typeof raw.entry === "string" && raw.entry.trim() ? raw.entry.trim() : text,
      exit: typeof raw.exit === "string" ? raw.exit : undefined,
      killSwitch: typeof raw.killSwitch === "string" ? raw.killSwitch : undefined,
      name: typeof raw.name === "string" ? raw.name : undefined,
    };

    const parsed = StrategySpecSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        spec: null,
        summary: "",
        warnings,
        model,
        error: parsed.error.issues.map((i) => i.message).join("; "),
      };
    }

    return { spec: parsed.data, summary: summarize(parsed.data), warnings, model };
  });
