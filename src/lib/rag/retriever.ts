/**
 * Retriever — public API for the RAG layer.
 *
 * Lazily builds the BM25 index on the first call, then serves sub-millisecond
 * keyword queries for the lifetime of the server process.
 */

import { BM25Index, type Chunk, type SearchResult } from "@/lib/rag/bm25";
import { loadCorpus } from "@/lib/rag/corpus-loader";

let _index: BM25Index | null = null;

function getIndex(): BM25Index {
  if (!_index) {
    const chunks = loadCorpus();
    _index = new BM25Index(chunks);
  }
  return _index;
}

/**
 * Retrieve the top-k most relevant chunks for a user query.
 *
 * @param query   Natural-language question from the developer
 * @param k       Number of chunks to return (default 6)
 * @returns       Array of matching chunks with their BM25 scores, sorted descending
 */
export function retrieve(query: string, k = 6): SearchResult[] {
  return getIndex().search(query, k);
}

/**
 * Format retrieved chunks into a context block for the LLM prompt.
 * Each chunk is labelled with its source file and section heading.
 */
export function formatContext(results: SearchResult[]): string {
  if (results.length === 0) return "(No documentation context found.)";

  return results
    .map(({ chunk }, i) =>
      [
        `--- [${i + 1}] Source: ${chunk.source} § ${chunk.section} ---`,
        chunk.text,
      ].join("\n")
    )
    .join("\n\n");
}

export type { Chunk, SearchResult };
