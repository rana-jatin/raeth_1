/**
 * Support Bot Chat API — server function exposed at /api/support/chat
 *
 * Pipeline:
 *   1. BM25 retrieve top-6 relevant documentation chunks
 *   2. Build system prompt with retrieved context
 *   3. Call Groq (llama-3.3-70b-versatile) with MCP tool schemas
 *   4. If model calls a tool, execute it against the live server state and loop
 *   5. Return the final answer with source citations as a JSON response
 *
 * This file is a TanStack Start API route (createServerFileRoute is available
 * in the Nitro/Cloudflare adapter at routes/api/**).
 */

import { createServerFn } from "@tanstack/react-start";
import Groq from "groq-sdk";
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from "groq-sdk/resources/chat/completions";
import { retrieve, formatContext } from "@/lib/rag/retriever";
import { MCP_TOOLS, executeTool } from "@/lib/mcp/tools";
import { startSimulator } from "@/lib/exchange/ts-simulator";

// ── Start the simulator once on first server call ─────────────────────────────
let _simStarted = false;

function ensureSimulator() {
  if (!_simStarted) {
    startSimulator();
    _simStarted = true;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatMessage[];
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, string | number | boolean | null>;
  success: boolean;
  data: string;   // JSON.stringify of result data or error message
}

export interface ChatResponse {
  answer: string;
  sources: Array<{ source: string; section: string; score: number }>;
  tool_calls: ToolCallRecord[];
  model: string;
  error?: string;
}

// ── Groq client ───────────────────────────────────────────────────────────────

function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY environment variable is not set.");
  return new Groq({ apiKey });
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(contextBlock: string): string {
  return `You are the RAETH Developer Support Bot — an expert assistant for the RAETH agentic exchange.

RAETH is a simulated trading testnet with:
- REST API at https://raeth.exchange/v1/
- WebSocket feed at wss://raeth.exchange/stream
- Remote MCP server at https://raeth.exchange/mcp
- Markets: BTC-PERP (linear perpetual), BTC-UPDOWN (5m binary), BTC-UPDOWN-15 (15m binary), BTC-PARLAY (3-leg parlay)
- Matching engine: deterministic CLOB, price-time FIFO priority, zero-qty rejection

## Documentation Context

The following passages are retrieved from the official RAETH documentation:

${contextBlock}

## Instructions

1. **Answer from documentation**: Base your answers on the retrieved documentation above. Quote schemas and parameter names exactly as documented.
2. **Use tools for live data**: If the developer asks about current prices, order status, balances, or book depth, call the appropriate tool to fetch real-time data.
3. **Be precise**: When quoting API endpoints, request bodies, or event types — use exact names (e.g. \`SubmitLimit\`, \`Accepted\`, \`GTC\`, \`ZERO_QTY\`).
4. **Cite sources**: At the end of each answer, list which documentation sections you drew from using [Source: filename § Section].
5. **Be honest about limits**: If something is not in the docs or live data, say so clearly rather than guessing.
6. **No order placement**: You are a READ-ONLY support bot. You cannot place orders, cancel orders, or modify any exchange state.
7. **Testnet context**: Remind users that RAETH is a simulated testnet — no real money is at risk.

Keep answers concise and developer-focused. Prefer code examples where helpful.`;
}

// ── Server function ───────────────────────────────────────────────────────────

export const supportChat = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as ChatRequest)
  .handler(async (ctx) => {
    ensureSimulator();

    const body = ctx.data as ChatRequest;
    const message = (body.message ?? "").trim();
    const history: ChatMessage[] = Array.isArray(body.history) ? body.history : [];

    // 1. RAG retrieval
    const retrieved = retrieve(message, 6);
    const contextBlock = formatContext(retrieved);
    const sources = retrieved.map((r: { chunk: { source: string; section: string }; score: number }) => ({
      source: r.chunk.source,
      section: r.chunk.section,
      score: parseFloat(r.score.toFixed(3)),
    }));

    // 2. Build messages
    const groq = getGroqClient();
    const systemPrompt = buildSystemPrompt(contextBlock);

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      // Last 6 turns of history
      ...history.slice(-6).map((m: ChatMessage) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    // 3. Agentic tool loop — max 3 rounds
    const toolCallRecords: ToolCallRecord[] = [];
    let answer = "";
    const MAX_TOOL_ROUNDS = 3;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const completion = await groq.chat.completions.create({
        model:       process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
        messages,
        tools:       MCP_TOOLS,
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens:  2048,
      });

      const choice = completion.choices[0];
      if (!choice) break;

      messages.push(choice.message as ChatCompletionMessageParam);

      // No tool calls → final answer
      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        answer = choice.message.content ?? "";
        break;
      }

      // Execute each tool call
      for (const tc of choice.message.tool_calls) {
        const toolName = tc.function.name;
        let toolArgs: Record<string, unknown> = {};
        try { toolArgs = JSON.parse(tc.function.arguments); } catch { /* ignore */ }

        const result = executeTool(toolName, toolArgs);
        const resultStr = result.success
          ? JSON.stringify(result.data, null, 2)
          : `Error: ${(result as { success: false; error: string }).error}`;
        toolCallRecords.push({
          tool: toolName,
          args: toolArgs as Record<string, string | number | boolean | null>,
          success: result.success,
          data: resultStr,
        });

        const toolMsg: ChatCompletionToolMessageParam = {
          role:         "tool",
          tool_call_id: tc.id,
          content:      resultStr,
        };
        messages.push(toolMsg);
      }

      if (round === MAX_TOOL_ROUNDS) {
        answer = choice.message.content ?? "I could not fetch the live data needed to answer your question.";
        break;
      }
    }

    return { answer, sources, tool_calls: toolCallRecords, model: "llama-3.3-70b-versatile" };
  });
