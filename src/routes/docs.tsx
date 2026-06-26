import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "../components/site-chrome";
import { getRequestOrigin } from "../lib/origin.functions";
import ogDocs from "../assets/og/docs.jpg";

export const Route = createFileRoute("/docs")({
  loader: async () => ({ origin: await getRequestOrigin() }),
  head: ({ loaderData }) => {
    const ogImage = `${loaderData?.origin ?? ""}${ogDocs}`;
    return {
      meta: [
        { title: "Docs — RAETH Agentic Exchange" },
        {
          name: "description",
          content:
            "RAETH developer docs: connect over REST, WebSocket, and remote MCP, authenticate a scoped sub-wallet, and place orders.",
        },
        { property: "og:title", content: "Docs — RAETH" },
        {
          property: "og:description",
          content: "Connect agents over REST, WebSocket, and MCP. Quickstart and API reference.",
        },
        { property: "og:type", content: "article" },
        { property: "og:url", content: "/docs" },
        { property: "og:image", content: ogImage },
        { name: "twitter:image", content: ogImage },
      ],
      links: [{ rel: "canonical", href: "/docs" }],
    };
  },
  component: DocsPage,
});

const SECTIONS = [
  { id: "quickstart", label: "Quickstart" },
  { id: "auth", label: "Authentication" },
  { id: "rest", label: "REST API" },
  { id: "ws", label: "WebSocket" },
  { id: "mcp", label: "Remote MCP" },
];

function DocsPage() {
  return (
    <PageShell>
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">RAETH / Docs</p>
        <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight">
          Build on the exchange substrate.
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          Everything in the terminal is available over REST, WebSocket, and a remote MCP server.
        </p>
      </section>

      <div className="mt-10 mb-4 grid gap-8 lg:grid-cols-[200px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-1">
            <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              On this page
            </p>
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block rounded px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {s.label}
              </a>
            ))}
          </div>
        </aside>

        <div className="max-w-2xl space-y-12">
          <DocBlock id="quickstart" title="Quickstart">
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              Connect Claude or any MCP client in one line. This registers the remote RAETH server
              and exposes the full tool catalog.
            </p>
            <Code>claude mcp add --transport http raeth https://raeth.exchange/mcp</Code>
          </DocBlock>

          <DocBlock id="auth" title="Authentication">
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              Scope an API key to a sub-wallet from the dashboard. Pass it as a bearer token; every
              order is checked against that wallet's bankroll and limits.
            </p>
            <Code>{`curl https://raeth.exchange/v1/account \\
  -H "Authorization: Bearer rk_test_…"`}</Code>
          </DocBlock>

          <DocBlock id="rest" title="REST API">
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              Read markets and place orders over plain HTTP.
            </p>
            <Code>{`POST /v1/orders
{
  "market": "BTC-UPDOWN",
  "side": "UP",
  "size": 120,
  "price": "0.55"
}`}</Code>
          </DocBlock>

          <DocBlock id="ws" title="WebSocket">
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              Subscribe to live book, fills, and settlement events.
            </p>
            <Code>{`const ws = new WebSocket("wss://raeth.exchange/stream");
ws.send(JSON.stringify({
  op: "subscribe",
  channels: ["book:BTC-UPDOWN", "fills"]
}));`}</Code>
          </DocBlock>

          <DocBlock id="mcp" title="Remote MCP">
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              The MCP server exposes tools like <code className="text-accent">get_markets</code>,{" "}
              <code className="text-accent">place_order</code>, and{" "}
              <code className="text-accent">stream_fills</code> so an LLM can trade directly. See the
              full catalog on the Agents page.
            </p>
            <Code>{`{
  "mcpServers": {
    "raeth": {
      "transport": "http",
      "url": "https://raeth.exchange/mcp"
    }
  }
}`}</Code>
          </DocBlock>
        </div>
      </div>
    </PageShell>
  );
}

function DocBlock({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-background p-4 font-mono text-xs leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  );
}
