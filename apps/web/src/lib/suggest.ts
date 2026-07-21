/** Cost suggestions. Prefer catalog neighbors, then optional Transformers.js embeddings. */

export type CatalogHint = {
  label: string;
  typicalCost: number;
  useCount: number;
};

let embedder: null | ((text: string) => Promise<number[]>) = null;
let embedderPromise: Promise<void> | null = null;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function tokenOverlapScore(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

async function ensureEmbedder(): Promise<boolean> {
  if (embedder) return true;
  if (!embedderPromise) {
    embedderPromise = (async () => {
      try {
        const { pipeline } = await import("@huggingface/transformers");
        const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
          dtype: "q8",
        });
        embedder = async (text: string) => {
          const out = await pipe(text, { pooling: "mean", normalize: true });
          return Array.from(out.data as Float32Array);
        };
      } catch {
        embedder = null;
      }
    })();
  }
  await embedderPromise;
  return !!embedder;
}

/** Suggest a planned cost for a new label. Falls back to 20 when nothing matches. */
export async function suggestCost(
  label: string,
  catalog: CatalogHint[],
  opts?: { preferModel?: boolean },
): Promise<{ cost: number; source: "catalog" | "overlap" | "embedding" | "default" }> {
  const trimmed = label.trim();
  if (!trimmed) return { cost: 20, source: "default" };

  const exact = catalog.find((c) => c.label.toLowerCase() === trimmed.toLowerCase());
  if (exact) return { cost: exact.typicalCost, source: "catalog" };

  let bestOverlap: CatalogHint | null = null;
  let bestScore = 0;
  for (const c of catalog) {
    const s = tokenOverlapScore(trimmed, c.label);
    if (s > bestScore) {
      bestScore = s;
      bestOverlap = c;
    }
  }
  if (bestOverlap && bestScore >= 0.35) {
    return { cost: bestOverlap.typicalCost, source: "overlap" };
  }

  if (opts?.preferModel !== false && catalog.length > 0) {
    const ok = await ensureEmbedder();
    if (ok && embedder) {
      try {
        const q = await embedder(trimmed);
        let best: CatalogHint | null = null;
        let score = -1;
        for (const c of catalog) {
          const e = await embedder(c.label);
          const s = cosine(q, e);
          if (s > score) {
            score = s;
            best = c;
          }
        }
        if (best && score >= 0.45) {
          return { cost: best.typicalCost, source: "embedding" };
        }
      } catch {
        /* fall through */
      }
    }
  }

  return { cost: 20, source: "default" };
}

/** Warm the embedding model in the background (first FAB open). */
export function prefetchSuggestModel(): void {
  void ensureEmbedder();
}
