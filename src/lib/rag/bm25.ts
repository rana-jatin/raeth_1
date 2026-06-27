/**
 * BM25 retrieval engine — pure TypeScript, zero dependencies.
 *
 * BM25 is the industry-standard keyword relevance ranking algorithm.
 * Parameters k1=1.5, b=0.75 are the traditional defaults that work well
 * across a wide range of corpora.
 *
 * Usage:
 *   const index = new BM25Index(chunks);
 *   const results = index.search("how do I submit a limit order", 6);
 */

export interface Chunk {
  id: string;
  source: string;    // filename, e.g. "api-spec.md"
  section: string;   // H2/H3 heading under which this chunk lives
  text: string;      // raw text of the chunk
  tokens: string[];  // pre-tokenised terms (lowercase, stemmed, stop-words removed)
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

// ─── Tokenisation ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a","an","and","are","as","at","be","by","do","for","from","get",
  "has","have","how","if","in","is","it","its","of","on","or","so",
  "that","the","this","to","was","what","when","where","which","with",
  "you","your","i","we","can","will","should","would","may","might",
  "does","did","been","being","had","not","no","any","all","but","my",
  "our","their","there","they","us","via","per","vs","more","than",
]);

/** Tokenise a string into BM25-ready terms. */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    // split on anything that is not alphanumeric or underscore
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

// ─── BM25 index ──────────────────────────────────────────────────────────────

const K1 = 1.5;
const B  = 0.75;

interface PostingEntry { chunkIdx: number; tf: number }

export class BM25Index {
  private chunks: Chunk[];
  /** inverted index: term → list of { chunkIdx, term-frequency } */
  private postings: Map<string, PostingEntry[]> = new Map();
  private avgDocLen: number;

  constructor(chunks: Chunk[]) {
    this.chunks = chunks;

    let totalLen = 0;
    for (let i = 0; i < chunks.length; i++) {
      const terms = chunks[i].tokens;
      totalLen += terms.length;

      // count term frequency in this document
      const freq = new Map<string, number>();
      for (const t of terms) freq.set(t, (freq.get(t) ?? 0) + 1);

      for (const [term, tf] of freq) {
        let list = this.postings.get(term);
        if (!list) { list = []; this.postings.set(term, list); }
        list.push({ chunkIdx: i, tf });
      }
    }
    this.avgDocLen = chunks.length > 0 ? totalLen / chunks.length : 1;
  }

  /** Score all chunks for a query string, return top-k sorted by score. */
  search(query: string, k = 6): SearchResult[] {
    const qTerms = tokenise(query);
    const N = this.chunks.length;
    if (N === 0 || qTerms.length === 0) return [];

    const scores = new Float64Array(N);

    for (const term of qTerms) {
      const list = this.postings.get(term);
      if (!list) continue;

      const df = list.length; // document frequency
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      for (const { chunkIdx, tf } of list) {
        const docLen = this.chunks[chunkIdx].tokens.length;
        const tfNorm =
          (tf * (K1 + 1)) /
          (tf + K1 * (1 - B + B * (docLen / this.avgDocLen)));
        scores[chunkIdx] += idf * tfNorm;
      }
    }

    // Collect non-zero scores and sort
    const results: SearchResult[] = [];
    for (let i = 0; i < N; i++) {
      if (scores[i] > 0) {
        results.push({ chunk: this.chunks[i], score: scores[i] });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }
}
