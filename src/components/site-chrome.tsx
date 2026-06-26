import { Link } from "@tanstack/react-router";
import { Menu, Search } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { useCommandPalette } from "./command-palette";

export const NAV: { label: string; to: string }[] = [
  { label: "Trade", to: "/trade" },
  { label: "HFT", to: "/markets" },
  { label: "Betting", to: "/markets" },
  { label: "Markets", to: "/markets" },
  { label: "Parlays", to: "/markets" },
  { label: "Leaderboard", to: "/markets" },
  { label: "Portfolio", to: "/agents" },
  { label: "Connect agent", to: "/agents" },
  { label: "Docs", to: "/docs" },
];

export function TopBanner() {
  return (
    <div className="border-b border-border bg-card">
      <div className="flex items-center justify-center gap-2 px-6 py-1.5 text-center font-mono text-[11px] tracking-wide text-muted-foreground">
        <span className="text-accent">Testnet</span>
        <span>· RAETH is in active development ·</span>
        <span>No real money at risk</span>
      </div>
    </div>
  );
}

export function Header() {
  const { setOpen } = useCommandPalette();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetTrigger
            className="rounded-md border border-border p-1.5 lg:hidden"
            aria-label="Open navigation menu"
          >
            <Menu className="h-4 w-4" />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 bg-background p-0">
            <SheetHeader className="border-b border-border px-5 py-4">
              <SheetTitle className="font-mono text-sm tracking-[0.15em]">RAETH</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col px-2 py-3">
              {NAV.map((item, i) => (
                <Link
                  key={`m-${item.label}-${i}`}
                  to={item.to}
                  onClick={() => setNavOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                  activeProps={{ className: "rounded-md px-3 py-2 text-sm text-foreground bg-secondary" }}
                  activeOptions={{ exact: item.to === "/" }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>

        <Link to="/" className="flex shrink-0 items-baseline gap-0.5">
          <span className="font-mono text-lg font-semibold tracking-[0.15em]">RAETH</span>
          <span className="font-mono text-[10px] text-accent">AI</span>
        </Link>
        <nav className="hidden items-center gap-5 lg:flex">
          {NAV.map((item, i) => (
            <Link
              key={`${item.label}-${i}`}
              to={item.to}
              className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-[13px] text-foreground" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center md:flex">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open command palette"
            className="group relative flex w-56 items-center gap-2 rounded-md border border-border bg-card py-1.5 pl-3 pr-12 text-left font-mono text-xs text-muted-foreground hover:border-accent/50"
          >
            <Search className="h-3 w-3 opacity-60" />
            <span>Search markets</span>
            <kbd className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
              Ctrl K
            </kbd>
          </button>
        </div>
        <div className="ml-auto flex items-center gap-3 md:ml-4">
          <span className="hidden text-xs text-muted-foreground xl:inline">
            Observing — sign up to keep fills
          </span>
          <Link
            to="/agents"
            className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Create Account
          </Link>
          <Link
            to="/agents"
            className="rounded-md border border-border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-secondary"
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-20 border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-0.5">
          <span className="font-mono text-sm font-semibold tracking-[0.15em] text-foreground">
            RAETH
          </span>
          <span className="font-mono text-[9px] text-accent">AI</span>
        </div>
        <p className="font-mono">Testnet · No real money at risk · Built on an event-sourced ledger</p>
        <div className="flex gap-4">
          <Link to="/trade" className="hover:text-foreground">Trade</Link>
          <Link to="/docs" className="hover:text-foreground">Docs</Link>
          <Link to="/agents" className="hover:text-foreground">Agents</Link>
          <Link to="/markets" className="hover:text-foreground">Markets</Link>
        </div>
      </div>
    </footer>
  );
}

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <TopBanner />
      <Header />
      <main className="mx-auto max-w-7xl px-6">{children}</main>
      <Footer />
    </div>
  );
}
