import { useEffect, useState, createContext, useContext, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { LineChart, Bot, BookOpen, Home, Layers, Wallet, Key, Activity } from "lucide-react";

type Ctx = { open: boolean; setOpen: (v: boolean) => void };
const CommandPaletteCtx = createContext<Ctx | null>(null);

export function useCommandPalette() {
  const c = useContext(CommandPaletteCtx);
  if (!c) throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return c;
}

const MARKETS = [
  { sym: "BTC-PERP", name: "BTC Perpetual" },
  { sym: "BTC-UPDOWN", name: "BTC Up/Down 5m" },
  { sym: "BTC-UPDOWN-15", name: "BTC Up/Down 15m" },
  { sym: "BTC-PARLAY", name: "BTC Parlay 3-leg" },
];

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    navigate({ to });
  };

  const goMarket = (symbol: string) => {
    setOpen(false);
    navigate({ to: "/trade", search: { symbol } });
  };

  return (
    <CommandPaletteCtx.Provider value={{ open, setOpen }}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search pages, markets, agents…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Pages">
            <CommandItem onSelect={() => go("/")}>
              <Home /> <span>Home</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/trade")}>
              <LineChart /> <span>Trade terminal</span>
              <CommandShortcut>T</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/markets")}>
              <Layers /> <span>Markets</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/agents")}>
              <Bot /> <span>Agents</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/docs")}>
              <BookOpen /> <span>Docs</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Markets">
            {MARKETS.map((m) => (
              <CommandItem
                key={m.sym}
                value={`${m.sym} ${m.name}`}
                onSelect={() => goMarket(m.sym)}
              >
                <Activity />
                <span>{m.name}</span>
                <CommandShortcut>{m.sym}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Agent shortcuts">
            <CommandItem onSelect={() => go("/agents")}>
              <Key /> <span>Generate API key</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/agents")}>
              <Wallet /> <span>Allocate sub-wallet</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/agents")}>
              <Bot /> <span>Connect Claude via MCP</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </CommandPaletteCtx.Provider>
  );
}
