/**
 * Corpus loader — reads all markdown corpus files and chunks them by heading.
 *
 * Documents are imported as raw strings so this works in both Cloudflare
 * Workers (no filesystem) and Node/Bun dev servers.
 */

import { type Chunk, tokenise } from "@/lib/rag/bm25";

// ── Import corpus files as raw strings ───────────────────────────────────────
import apiSpec       from "./corpus/api-spec.md?raw";
import matchingEngine from "./corpus/matching-engine.md?raw";
import mcpTools      from "./corpus/mcp-tools.md?raw";
import marketRules   from "./corpus/market-rules.md?raw";
import llmsTxt       from "./corpus/llms.txt?raw";

const CORPUS_FILES: { source: string; content: string }[] = [
  { source: "api-spec.md",        content: apiSpec },
  { source: "matching-engine.md", content: matchingEngine },
  { source: "mcp-tools.md",       content: mcpTools },
  { source: "market-rules.md",    content: marketRules },
  { source: "llms.txt",           content: llmsTxt },
];

// ── Chunking by heading ───────────────────────────────────────────────────────

/** Split a markdown string into chunks delimited by H2 (##) or H3 (###) headings. */
function chunkMarkdown(source: string, content: string): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];

  let currentSection = "Introduction";
  let currentLines: string[] = [];
  let chunkIndex = 0;

  function flush() {
    const text = currentLines.join("\n").trim();
    if (text.length < 30) return; // skip near-empty chunks
    const id = `${source}#${chunkIndex++}`;
    chunks.push({
      id,
      source,
      section: currentSection,
      text,
      tokens: tokenise(text + " " + currentSection),
    });
  }

  for (const line of lines) {
    // H2 or H3 heading starts a new chunk
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentSection = headingMatch[1].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return chunks;
}

// ── Singleton index ───────────────────────────────────────────────────────────

let _chunks: Chunk[] | null = null;

/** Load and chunk all corpus files. Result is cached after first call. */
export function loadCorpus(): Chunk[] {
  if (_chunks) return _chunks;

  const allChunks: Chunk[] = [];
  for (const { source, content } of CORPUS_FILES) {
    const fileChunks = chunkMarkdown(source, content);
    allChunks.push(...fileChunks);
  }
  _chunks = allChunks;
  return _chunks;
}
