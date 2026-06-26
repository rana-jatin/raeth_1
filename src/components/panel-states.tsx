import { Component, type ReactNode } from "react";
import { useEffect, useState } from "react";
import { Skeleton } from "./ui/skeleton";

/**
 * Simulated feed connection status for a live panel. Flips to "ready" shortly
 * after mount and re-enters "loading" whenever the watched key (market) changes,
 * mimicking the subscribe → snapshot handshake of a real market data feed.
 */
export function useFeedStatus(key: unknown, delay = 650): "loading" | "ready" {
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    setStatus("loading");
    const id = setTimeout(() => setStatus("ready"), delay);
    return () => clearTimeout(id);
  }, [key, delay]);

  return status;
}

export function OrderBookSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3" aria-busy="true">
      <p className="px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        Order book
      </p>
      <div className="mt-2 grid grid-cols-2 px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Price</span>
        <span className="text-right">Size</span>
      </div>
      <div className="mt-2 space-y-1.5 px-1">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={`sa-${i}`} className="grid grid-cols-2 gap-2">
            <Skeleton className="h-3 w-16 bg-destructive/15" />
            <Skeleton className="ml-auto h-3 w-10" />
          </div>
        ))}
        <div className="my-2 flex items-center justify-between border-y border-border py-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-14" />
        </div>
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={`sb-${i}`} className="grid grid-cols-2 gap-2">
            <Skeleton className="h-3 w-16 bg-live/15" />
            <Skeleton className="ml-auto h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card/50 p-3" aria-busy="true">
      <div className="flex items-center justify-between px-1">
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-7" />
          ))}
        </div>
      </div>
      <div className="mt-2 flex h-56 w-full items-end gap-1">
        {Array.from({ length: 28 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1"
            style={{ height: `${(30 + Math.abs(Math.sin(i * 0.9)) * 60).toFixed(2)}%` }}
          />
        ))}
      </div>
      <div className="mt-auto grid grid-cols-4 gap-2 border-t border-border px-1 pt-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-14" />
        ))}
      </div>
    </div>
  );
}

export function PanelError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card/50 p-6 text-center"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10 font-mono text-sm text-destructive">
        !
      </span>
      <div>
        <p className="font-mono text-[11px] uppercase tracking-wide text-foreground">{title}</p>
        <p className="mt-1.5 max-w-[26ch] text-[12px] leading-relaxed text-muted-foreground">
          {message ?? "The live feed dropped. This usually clears on its own — try reconnecting."}
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border px-3 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:bg-secondary"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}

type BoundaryProps = {
  title: string;
  message?: string;
  children: ReactNode;
};

type BoundaryState = { hasError: boolean; key: number };

/** Keeps a single panel's runtime error from taking down the whole terminal. */
export class PanelErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false, key: 0 };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Panel error:", error);
  }

  private retry = () => {
    this.setState((s) => ({ hasError: false, key: s.key + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return <PanelError title={this.props.title} message={this.props.message} onRetry={this.retry} />;
    }
    return <div key={this.state.key}>{this.props.children}</div>;
  }
}
