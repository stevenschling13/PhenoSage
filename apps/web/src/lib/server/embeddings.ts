import "server-only";
import { createHash } from "node:crypto";
import type OpenAI from "openai";
import { getAIClient } from "./ai-client";
import { getCircuitBreaker, CircuitOpenError } from "./circuit-breaker";
import { getDbClient } from "./db";
import { logServerEvent } from "./request-id";

const EMBEDDING_MODEL = "gemini-embedding-2";
const EMBEDDING_DIMENSIONS = 1_536;
const EMBEDDING_TIMEOUT_MS = 10_000;
const EMBEDDING_CIRCUIT_KEY = "gemini-embeddings";

type EmbeddingErrorCode =
  | "configuration_error"
  | "circuit_open"
  | "embedding_unavailable"
  | "malformed_provider_response";

type EmbeddingResult =
  | {
      ok: true;
      embeddings: number[][];
      providerRequestId: string | null;
    }
  | { ok: false; code: EmbeddingErrorCode };

export type FindingEmbeddingInput = {
  id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  recommendation?: string | null;
  embeddingContentHash?: string | null;
  embedding?: unknown;
};

type FindingEmbeddingUpdate = {
  id: string;
  embedding: number[];
  embeddingContentHash: string;
};

export type PersistFindingEmbeddingsResult = {
  ok: boolean;
  generated: number;
  updated: number;
  skipped: number;
  failed: number;
  code?: EmbeddingErrorCode | "update_failed";
};

type SupabaseUpdateResult = {
  error: { message: string } | null;
};

type SupabaseUpdateClient = {
  from: (_table: "plant_findings") => {
    update: (_values: {
      embedding: string;
      embedding_content_hash: string;
    }) => {
      eq: (
        _column: "id",
        _value: string,
      ) => {
        abortSignal: (
          _signal: AbortSignal,
        ) => PromiseLike<SupabaseUpdateResult>;
      };
    };
  };
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildFindingEmbeddingText(input: {
  category: string;
  severity: string;
  title: string;
  description?: string | null;
  recommendation?: string | null;
}): string {
  return [
    `Title: ${normalizeWhitespace(input.title)}`,
    `Category: ${input.category}`,
    `Severity: ${input.severity}`,
    input.description
      ? `Description: ${normalizeWhitespace(input.description)}`
      : null,
    input.recommendation
      ? `Recommendation: ${normalizeWhitespace(input.recommendation)}`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join("\n");
}

export function findingEmbeddingContentHash(text: string): string {
  const digest = createHash("sha256")
    .update(`${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}:`)
    .update(text)
    .digest("hex");
  return `v1:${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}:${digest}`;
}

function getEmbeddingClient(): OpenAI | null {
  try {
    return getAIClient();
  } catch (err) {
    if (err instanceof Error && /GEMINI_API_KEY/.test(err.message)) {
      return null;
    }
    throw err;
  }
}

function providerRequestIdFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("_request_id" in value && typeof value._request_id === "string") {
    return value._request_id;
  }
  if ("request_id" in value && typeof value.request_id === "string") {
    return value.request_id;
  }
  return undefined;
}

function isEmbeddingVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === EMBEDDING_DIMENSIONS &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

export async function generateFindingEmbeddings(
  texts: string[],
  opts: { requestId: string },
): Promise<EmbeddingResult> {
  if (texts.length === 0) {
    return { ok: true, embeddings: [], providerRequestId: null };
  }

  let client: OpenAI | null;
  try {
    client = getEmbeddingClient();
    if (!client) {
      logServerEvent("warn", "finding embeddings skipped: Gemini key missing", {
        requestId: opts.requestId,
      });
      return { ok: false, code: "configuration_error" };
    }
  } catch (err) {
    logServerEvent("warn", "finding embeddings client init failed", {
      requestId: opts.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, code: "configuration_error" };
  }

  const breaker = getCircuitBreaker(EMBEDDING_CIRCUIT_KEY, {
    failureThreshold: 3,
    windowMs: 60_000,
    cooldownMs: 30_000,
  });

  try {
    const { data, request_id: providerRequestId } = await breaker.run(() =>
      client.embeddings
        .create(
          {
            dimensions: EMBEDDING_DIMENSIONS,
            input: texts,
            model: EMBEDDING_MODEL,
          },
          { timeout: EMBEDDING_TIMEOUT_MS },
        )
        .withResponse(),
    );

    const embeddings = data.data.map((entry) => entry.embedding);
    if (
      embeddings.length !== texts.length ||
      embeddings.some((embedding) => !isEmbeddingVector(embedding))
    ) {
      logServerEvent("warn", "finding embeddings malformed provider response", {
        requestId: opts.requestId,
        providerRequestId,
        expected: texts.length,
        received: embeddings.length,
      });
      return { ok: false, code: "malformed_provider_response" };
    }

    logServerEvent("info", "finding embeddings generated", {
      requestId: opts.requestId,
      providerRequestId,
      count: embeddings.length,
      model: EMBEDDING_MODEL,
    });

    return { ok: true, embeddings, providerRequestId };
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      logServerEvent("warn", "finding embeddings circuit open", {
        requestId: opts.requestId,
        retryAfterSeconds: err.retryAfterSeconds,
      });
      return { ok: false, code: "circuit_open" };
    }

    const providerRequestId = providerRequestIdFrom(err);
    logServerEvent("warn", "finding embeddings unavailable", {
      requestId: opts.requestId,
      providerRequestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, code: "embedding_unavailable" };
  }
}

export async function persistFindingEmbeddings(
  db: SupabaseUpdateClient,
  findings: FindingEmbeddingInput[],
  opts: { requestId: string },
): Promise<PersistFindingEmbeddingsResult> {
  const candidates = findings
    .map((finding) => {
      const text = buildFindingEmbeddingText(finding);
      const hash = findingEmbeddingContentHash(text);
      return { finding, hash, text };
    })
    .filter(
      ({ finding, hash }) =>
        !finding.embedding ||
        finding.embeddingContentHash === null ||
        finding.embeddingContentHash !== hash,
    );

  const skipped = findings.length - candidates.length;
  if (candidates.length === 0) {
    return { ok: true, generated: 0, updated: 0, skipped, failed: 0 };
  }

  const generated = await generateFindingEmbeddings(
    candidates.map((candidate) => candidate.text),
    opts,
  );
  if (!generated.ok) {
    return {
      ok: false,
      generated: 0,
      updated: 0,
      skipped,
      failed: candidates.length,
      code: generated.code,
    };
  }

  const updates: FindingEmbeddingUpdate[] = candidates.map(
    (candidate, index) => ({
      id: candidate.finding.id,
      embedding: generated.embeddings[index] ?? [],
      embeddingContentHash: candidate.hash,
    }),
  );

  const settled = await Promise.allSettled(
    updates.map(async (update) => {
      const result = await db
        .from("plant_findings")
        .update({
          embedding: JSON.stringify(update.embedding),
          embedding_content_hash: update.embeddingContentHash,
        })
        .eq("id", update.id)
        .abortSignal(AbortSignal.timeout(EMBEDDING_TIMEOUT_MS));

      if (result.error) {
        throw new Error(result.error.message);
      }
    }),
  );

  const failed = settled.filter((item) => item.status === "rejected").length;
  const updated = settled.length - failed;
  if (failed > 0) {
    logServerEvent("warn", "finding embedding updates partially failed", {
      requestId: opts.requestId,
      updated,
      failed,
    });
  }

  return {
    ok: failed === 0,
    generated: generated.embeddings.length,
    updated,
    skipped,
    failed,
    ...(failed > 0 ? { code: "update_failed" } : {}),
  };
}

export async function persistSingleFindingEmbeddingBestEffort(
  finding: FindingEmbeddingInput,
  opts: { requestId: string; userId: string | null },
): Promise<void> {
  try {
    const embeddingResult = await persistFindingEmbeddings(
      getDbClient(),
      [finding],
      { requestId: opts.requestId },
    );
    if (!embeddingResult.ok) {
      logServerEvent("warn", "chat finding embedding skipped", {
        requestId: opts.requestId,
        userId: opts.userId,
        findingId: finding.id,
        code: embeddingResult.code,
      });
    }
  } catch (embeddingErr) {
    logServerEvent("warn", "chat finding embedding threw", {
      requestId: opts.requestId,
      userId: opts.userId,
      findingId: finding.id,
      error:
        embeddingErr instanceof Error
          ? embeddingErr.message
          : String(embeddingErr),
    });
  }
}
