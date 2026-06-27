import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageShell } from "../components/site-chrome";
import { getRequestOrigin } from "../lib/origin.functions";
import { supportChat } from "../lib/support-chat";
import type { ChatMessage, ChatResponse, ToolCallRecord } from "../lib/support-chat";

export const Route = createFileRoute("/support")({
  loader: async () => ({ origin: await getRequestOrigin() }),
  head: () => ({
    meta: [
      { title: "Support Bot — RAETH Agentic Exchange" },
      {
        name: "description",
        content:
          "RAETH Developer Support Bot — ask anything about the API, matching engine, MCP tools, or live market state.",
      },
      { property: "og:title", content: "Support Bot — RAETH" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/support" },
    ],
    links: [{ rel: "canonical", href: "/support" }],
  }),
  component: SupportPage,
});

// ── Suggested questions ───────────────────────────────────────────────────────

const SUGGESTIONS = [
  "How do I submit a GTC limit order via REST?",
  "Why was my order rejected with ZERO_QTY?",
  "What is the current BTC-PERP order book depth?",
  "How does IOC differ from GTC?",
  "What events does the engine emit on a partial fill?",
  "How do I connect Claude to the RAETH MCP server?",
  "What's the funding rate for BTC-PERP?",
  "Explain price-time FIFO priority.",
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConversationEntry {
  id: string;
  userMessage: string;
  response: ChatResponse | null;
  loading: boolean;
  error: string | null;
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SupportPage() {
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const entryIdCounter = useRef(0);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [entries, scrollToBottom]);

  const send = useCallback(async (msg: string) => {
    const trimmed = msg.trim();
    if (!trimmed || isLoading) return;

    const id = String(entryIdCounter.current++);
    const history: ChatMessage[] = entries
      .filter(e => e.response)
      .slice(-6)
      .flatMap(e => [
        { role: "user"      as const, content: e.userMessage },
        { role: "assistant" as const, content: e.response!.answer },
      ]);

    const entry: ConversationEntry = { id, userMessage: trimmed, response: null, loading: true, error: null };
    setEntries(prev => [...prev, entry]);
    setInput("");
    setIsLoading(true);

    try {
      const data = await supportChat({ data: { message: trimmed, history } as unknown as import("../lib/support-chat").ChatRequest }) as ChatResponse;
      setEntries(prev => prev.map(e => e.id === id ? { ...e, response: data, loading: false } : e));
    } catch (err) {
      setEntries(prev =>
        prev.map(e => e.id === id ? { ...e, loading: false, error: String(err) } : e)
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [entries, isLoading]);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); send(input); };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  return (
    <PageShell>
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">RAETH / Support</p>
        <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight">
          Developer Support Bot
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          Ask anything about the RAETH API, matching engine internals, MCP tools, or live market state.
          Powered by <span className="text-accent font-mono">Groq</span> + BM25 RAG over the full documentation corpus.
        </p>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Chat window */}
        <div className="flex flex-col rounded-lg border border-border bg-card/40 overflow-hidden" style={{ minHeight: "600px" }}>
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-6" style={{ maxHeight: "520px" }}>
            {entries.length === 0 && (
              <EmptyState suggestions={SUGGESTIONS} onSelect={(q) => { setInput(q); inputRef.current?.focus(); }} />
            )}
            {entries.map(entry => (
              <MessagePair key={entry.id} entry={entry} />
            ))}
          </div>

          {/* Input */}
          <div className="border-t border-border bg-card px-4 py-3">
            <form onSubmit={handleSubmit} className="flex items-end gap-3">
              <textarea
                ref={inputRef}
                id="support-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about the API, matching engine, MCP tools, or live state…"
                rows={2}
                disabled={isLoading}
                className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-accent/60 focus:outline-none disabled:opacity-50"
              />
              <button
                id="support-send-btn"
                type="submit"
                disabled={isLoading || !input.trim()}
                className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isLoading ? <SpinIcon /> : "Send"}
              </button>
            </form>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">
              Enter to send · Shift+Enter for newline · Powered by Groq llama-3.3-70b
            </p>
          </div>
        </div>

        {/* Side panel */}
        <SidePanel entries={entries} />
      </div>
    </PageShell>
  );
}

// ── Empty state with suggestions ──────────────────────────────────────────────

function EmptyState({ suggestions, onSelect }: { suggestions: string[]; onSelect: (q: string) => void }) {
  return (
    <div className="flex flex-col items-start gap-5 py-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] text-accent">AI</span>
        <p className="text-[14px] text-foreground">
          Hi! I'm the RAETH Developer Support Bot. I have full context of the API docs, matching engine internals, and can fetch live exchange state. What can I help you with?
        </p>
      </div>
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground mb-3">Suggested questions</p>
        <div className="flex flex-wrap gap-2">
          {suggestions.map(q => (
            <button
              key={q}
              onClick={() => onSelect(q)}
              className="rounded-md border border-border bg-secondary px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Message pair (user + assistant) ──────────────────────────────────────────

function MessagePair({ entry }: { entry: ConversationEntry }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <div className="space-y-3">
      {/* User bubble */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-primary/15 px-4 py-2.5 font-mono text-[13px] text-foreground">
          {entry.userMessage}
        </div>
      </div>

      {/* Bot bubble */}
      <div className="flex gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[9px] text-accent">AI</span>
        <div className="flex-1 space-y-2">
          {entry.loading && <LoadingDots />}

          {entry.error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 font-mono text-[12px] text-destructive">
              ⚠ {entry.error}
            </div>
          )}

          {entry.response && (
            <>
              <div className="prose-sm max-w-none text-[13px] leading-relaxed text-foreground">
                <MarkdownAnswer text={entry.response.answer} />
              </div>

              {/* Tool call pills */}
              {entry.response.tool_calls.length > 0 && (
                <div className="space-y-1">
                  <button
                    onClick={() => setToolsOpen(o => !o)}
                    className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-accent hover:text-accent/80"
                  >
                    <span className={`transition-transform ${toolsOpen ? "rotate-90" : ""}`}>▶</span>
                    {entry.response.tool_calls.length} live data {entry.response.tool_calls.length === 1 ? "call" : "calls"}
                  </button>
                  {toolsOpen && (
                    <div className="space-y-2 pl-3 border-l border-accent/20">
                      {entry.response.tool_calls.map((tc, i) => (
                        <ToolCallCard key={i} tc={tc} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Sources */}
              {entry.response.sources.length > 0 && (
                <div>
                  <button
                    onClick={() => setSourcesOpen(o => !o)}
                    className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    <span className={`transition-transform ${sourcesOpen ? "rotate-90" : ""}`}>▶</span>
                    {entry.response.sources.length} documentation {entry.response.sources.length === 1 ? "source" : "sources"} cited
                  </button>
                  {sourcesOpen && (
                    <div className="mt-2 space-y-1 pl-3 border-l border-border">
                      {entry.response.sources.map((s, i) => (
                        <p key={i} className="font-mono text-[11px] text-muted-foreground">
                          <span className="text-accent">{s.source}</span>
                          {" § "}
                          <span>{s.section}</span>
                          <span className="ml-2 opacity-50">(score: {s.score})</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tool call card ────────────────────────────────────────────────────────────

function ToolCallCard({ tc }: { tc: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-accent/20 bg-accent/5 px-3 py-2">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 text-left">
        <span className="text-accent text-[10px]">📡</span>
        <span className="font-mono text-[11px] text-accent">{tc.tool}</span>
        {Object.keys(tc.args).length > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground truncate">
            ({Object.entries(tc.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})
          </span>
        )}
        <span className={`ml-1 font-mono text-[9px] ${tc.success ? "text-green-500" : "text-red-400"}`}>
          {tc.success ? "✓" : "✗"}
        </span>
        <span className="ml-auto font-mono text-[9px] text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <pre className="mt-2 overflow-x-auto rounded bg-background px-3 py-2 font-mono text-[11px] text-foreground">
          {tc.data}
        </pre>
      )}
    </div>
  );
}

// ── Side panel (live context summary) ────────────────────────────────────────

function SidePanel({ entries }: { entries: ConversationEntry[] }) {
  const lastResponse = [...entries].reverse().find(e => e.response)?.response;

  return (
    <div className="flex flex-col gap-4">
      {/* Status card */}
      <div className="rounded-lg border border-border bg-card/50 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-3">System</p>
        <div className="space-y-2 font-mono text-[12px]">
          <StatusRow label="LLM" value="Groq llama-3.3-70b" ok />
          <StatusRow label="Retrieval" value="BM25 in-memory" ok />
          <StatusRow label="Live state" value="TS simulator" ok />
          <StatusRow label="Corpus" value="5 documents" ok />
        </div>
      </div>

      {/* Last sources */}
      {lastResponse && lastResponse.sources.length > 0 && (
        <div className="rounded-lg border border-border bg-card/50 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-3">Last Retrieved</p>
          <div className="space-y-1.5">
            {lastResponse.sources.slice(0, 4).map((s, i) => (
              <div key={i} className="font-mono text-[11px]">
                <p className="text-accent">{s.source}</p>
                <p className="text-muted-foreground truncate">§ {s.section}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Corpus files */}
      <div className="rounded-lg border border-border bg-card/50 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-3">Corpus</p>
        <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
          {["api-spec.md", "matching-engine.md", "mcp-tools.md", "market-rules.md", "llms.txt"].map(f => (
            <p key={f} className="flex items-center gap-1.5">
              <span className="text-accent">·</span>
              <span>{f}</span>
            </p>
          ))}
        </div>
      </div>

      {/* MCP live tools */}
      <div className="rounded-lg border border-border bg-card/50 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-3">Live Tools</p>
        <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
          {[
            "get_order_status",
            "check_subwallet_balance",
            "get_market_snapshot",
            "get_orderbook_depth",
            "get_funding_rate",
            "list_open_markets",
            "get_resting_orders",
            "get_fill_history",
          ].map(t => (
            <p key={t} className="flex items-center gap-1.5 truncate">
              <span className="text-green-500">●</span>
              <span>{t}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Utility components ────────────────────────────────────────────────────────

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />
        <span className="text-foreground">{value}</span>
      </span>
    </div>
  );
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-accent/60 animate-pulse"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

function SpinIcon() {
  return (
    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

/** Render a markdown-ish answer — handles code blocks, inline code, and bold. */
function MarkdownAnswer({ text }: { text: string }) {
  // Split on code blocks
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const lines = part.split("\n");
          const lang = lines[0].replace("```", "").trim();
          const code = lines.slice(1, -1).join("\n");
          return (
            <pre key={i} className="my-2 overflow-x-auto rounded-md border border-border bg-background px-4 py-3 font-mono text-[12px] text-foreground">
              {lang && <span className="block font-mono text-[10px] text-muted-foreground mb-2">{lang}</span>}
              <code>{code}</code>
            </pre>
          );
        }
        // Inline formatting
        const formatted = part
          .split(/(`[^`]+`)/g)
          .map((seg, j) =>
            seg.startsWith("`")
              ? <code key={j} className="rounded bg-secondary px-1 py-0.5 font-mono text-[12px] text-accent">{seg.slice(1, -1)}</code>
              : seg.split(/(\*\*[^*]+\*\*)/g).map((s, k) =>
                  s.startsWith("**")
                    ? <strong key={k} className="font-semibold">{s.slice(2, -2)}</strong>
                    : <span key={k}>{s}</span>
                )
          );
        return <span key={i}>{formatted}</span>;
      })}
    </>
  );
}
