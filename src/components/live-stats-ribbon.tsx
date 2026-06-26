import { useEffect, useState } from "react";

function fmtUsd(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}m`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function LiveStatsRibbon() {
  const [vol, setVol] = useState(4_530_000);
  const [agents, setAgents] = useState(318);
  const [lastFill, setLastFill] = useState({ sym: "BTC-PERP", side: "BUY", px: 64931.0, qty: 0.42 });

  useEffect(() => {
    const id = setInterval(() => {
      setVol((v) => v + Math.random() * 1800);
      setAgents((a) => Math.max(200, a + Math.round((Math.random() - 0.45) * 3)));
      const buy = Math.random() > 0.5;
      const perp = Math.random() > 0.5;
      setLastFill({
        sym: perp ? "BTC-PERP" : "BTC-UPDOWN",
        side: buy ? "BUY" : "SELL",
        px: perp ? 64900 + Math.random() * 80 : 0.4 + Math.random() * 0.2,
        qty: perp ? +(0.05 + Math.random() * 1.2).toFixed(2) : +(10 + Math.random() * 80).toFixed(0),
      });
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="border-b border-border bg-background/60">
      <div
        className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2 font-mono text-[11px] tracking-wide text-muted-foreground tabular-nums"
        aria-live="polite"
      >
        <span className="flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
          </span>
          <span className="text-muted-foreground">24h vol</span>
          <span className="text-foreground">{fmtUsd(vol)}</span>
        </span>
        <span>
          <span>agents online </span>
          <span className="text-foreground">{agents}</span>
        </span>
        <span className="truncate">
          <span>last fill </span>
          <span className={lastFill.side === "BUY" ? "text-live" : "text-destructive"}>
            {lastFill.side}
          </span>{" "}
          <span className="text-foreground">{lastFill.sym}</span>{" "}
          <span className="text-foreground">
            {typeof lastFill.px === "number" && lastFill.px > 100
              ? lastFill.px.toFixed(1)
              : lastFill.px.toFixed(3)}
          </span>{" "}
          × {lastFill.qty}
        </span>
        <span className="ml-auto hidden sm:inline">testnet · simulated feed</span>
      </div>
    </div>
  );
}
