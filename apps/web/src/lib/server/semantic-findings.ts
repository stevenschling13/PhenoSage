import "server-only";
import type { createSupabaseServerClient } from "./auth";
import { generateFindingEmbeddings } from "./embeddings";
import { logServerEvent } from "./request-id";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const DEFAULT_THRESHOLD = 0.72;
const SEARCH_TIMEOUT_MS = 5_000;

type SupabaseUserClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export type SimilarFinding = {
  id: string;
  plantId: string;
  plantName: string | null;
  category: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string | null;
  source: string;
  createdAt: string;
  similarity: number;
};

type SimilarFindingRpcRow = {
  id: string;
  plant_id: string;
  plant_name: string | null;
  category: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string | null;
  source: string;
  created_at: string;
  similarity: number;
};

export type FindSimilarGrowFindingsResult =
  | { ok: true; data: SimilarFinding[] }
  | {
      ok: false;
      code:
        | "embedding_unavailable"
        | "semantic_search_unavailable"
        | "configuration_error"
        | "circuit_open"
        | "malformed_provider_response";
    };

function clampLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value ?? DEFAULT_LIMIT)));
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function findSimilarGrowFindings(params: {
  supabase: SupabaseUserClient;
  growId: string;
  query: string;
  limit?: number;
  threshold?: number;
  excludeFindingIds?: string[];
  requestId: string;
}): Promise<FindSimilarGrowFindingsResult> {
  const embeddingResult = await generateFindingEmbeddings([params.query], {
    requestId: params.requestId,
  });
  if (!embeddingResult.ok) {
    return { ok: false, code: embeddingResult.code };
  }

  const limit = clampLimit(params.limit);
  const threshold =
    typeof params.threshold === "number" && Number.isFinite(params.threshold)
      ? Math.max(0, Math.min(1, params.threshold))
      : DEFAULT_THRESHOLD;

  const { data, error } = await params.supabase
    .rpc("match_similar_grow_findings", {
      p_exclude_finding_ids: params.excludeFindingIds ?? [],
      p_grow_id: params.growId,
      p_match_count: limit,
      p_match_threshold: threshold,
      p_query_embedding: vectorLiteral(embeddingResult.embeddings[0] ?? []),
    })
    .abortSignal(AbortSignal.timeout(SEARCH_TIMEOUT_MS));

  if (error) {
    logServerEvent("warn", "semantic finding search failed", {
      requestId: params.requestId,
      growId: params.growId,
      error: error.message,
    });
    return { ok: false, code: "semantic_search_unavailable" };
  }

  const rows = (data ?? []) as SimilarFindingRpcRow[];
  return {
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      plantId: row.plant_id,
      plantName: row.plant_name,
      category: row.category,
      severity: row.severity,
      title: row.title,
      description: row.description,
      recommendation: row.recommendation,
      source: row.source,
      createdAt: row.created_at,
      similarity: row.similarity,
    })),
  };
}
