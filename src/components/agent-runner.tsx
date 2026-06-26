import { useCallback, useEffect, useRef, useState } from "react";

type Line = {
  kind: "cmd" | "sys" | "data" | "ok" | "warn";
  text: string;
  delay: number;
};

const SCRIPT: Line[] = [
  { kind: "cmd", text: "$ raeth agent run --strategy momentum --market BTC-UPDOWN", delay: 120 },
  { kind: "sys", text: "› connecting to wss://raeth.exchange/stream ...", delay: 420 },
  { kind: "ok", text: "✓ session established · sub-wallet 0x9f…c41a · bankroll $10,000", delay: 380 },
  { kind: "sys", text: "› subscribing to BTC Up/Down · 5-minute window", delay: 360 },
  { kind: "data", text: "tick  BTC spot   $64,812.40   Δ +0.18%   window 02:41 remaining", delay: 300 },
  { kind: "data", text: "book  UP 0.54 / 0.55   DOWN 0.45 / 0.46   depth 18.2k", delay: 320 },
  { kind: "sys", text: "› signal: 5m momentum +0.42σ → bias UP", delay: 360 },
  { kind: "ok", text: "✓ order accepted  BUY UP  size 120  @ 0.55  id 0x4c2…91", delay: 420 },
  { kind: "data", text: "fill  UP 120 @ 0.55   notional $66.00   fee $0.07", delay: 300 },
  { kind: "data", text: "tick  BTC spot   $64,931.02   Δ +0.37%   mark UP 0.61", delay: 360 },
  { kind: "warn", text: "! funding window closing in 00:38 — locking position", delay: 380 },
  { kind: "sys", text: "› settlement: BTC closed above strike → UP wins", delay: 420 },
  { kind: "ok", text: "✓ settled  payout $120.00  pnl +$54.00 (+81.8%)", delay: 360 },
  { kind: "sys", text: "› bankroll $10,054.00 · 1 trade · win rate 100%", delay: 300 },
  { kind: "ok", text: "✓ agent idle — awaiting next 5-minute window", delay: 0 },
];

const COLOR: Record<Line["kind"], string> = {
  cmd: "text-foreground",
  sys: "text-muted-foreground",
  data: "text-accent",
  ok: "text-live",
  warn: "text-yellow-400",
};

export function AgentRunner() {
  const [visible, setVisible] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const run = useCallback(() => {
    clearTimers();
    setVisible([]);
    setDone(false);
    setRunning(true);
    let cumulative = 0;
    SCRIPT.forEach((line, idx) => {
      cumulative += idx === 0 ? 150 : SCRIPT[idx - 1].delay;
      const t = setTimeout(() => {
        setVisible((prev) => [...prev, line]);
        if (idx === SCRIPT.length - 1) {
          setRunning(false);
          setDone(true);
        }
      }, cumulative);
      timers.current.push(t);
    });
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setVisible([]);
    setRunning(false);
    setDone(false);
  }, [clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visible]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-live/70" />
          </span>
          <span className="ml-2">raeth-agent — sandbox</span>
        </div>
        <span className="flex items-center gap-1.5 font-mono text-[11px]">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              running ? "animate-pulse bg-live" : done ? "bg-live" : "bg-muted-foreground"
            }`}
          />
          <span className={running || done ? "text-live" : "text-muted-foreground"}>
            {running ? "streaming" : done ? "complete" : "idle"}
          </span>
        </span>
      </div>

      <div
        ref={scrollRef}
        className="h-72 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-relaxed"
      >
        {visible.length === 0 && !running ? (
          <p className="text-muted-foreground">
            Press <span className="text-foreground">Run sample agent</span> to stream a live momentum
            strategy against BTC Up/Down on the testnet.
          </p>
        ) : (
          visible.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap ${COLOR[line.kind]}`}>
              {line.text}
            </div>
          ))
        )}
        {running && <span className="inline-block h-3.5 w-2 animate-pulse bg-accent align-middle" />}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-card px-4 py-3">
        <button
          onClick={run}
          disabled={running}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Running…" : done ? "Run again" : "Run sample agent"}
        </button>
        <button
          onClick={reset}
          disabled={running || visible.length === 0}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear
        </button>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          simulated stream · no real orders
        </span>
      </div>
    </div>
  );
}
