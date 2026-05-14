import "server-only";
import type { AnalysisResponse } from "@phenosage/shared";
import { getAnalysisServiceConfig } from "./analysis-config";
import { CircuitOpenError, getCircuitBreaker } from "./circuit-breaker";
import { REQUEST_ID_HEADER, withRequestIdHeader } from "./request-id";
import {
  UpstreamError,
  withResilience,
  type ResilienceOptions,
} from "./resilience";

interface ProxyOptions {
  endpoint: string;
  method?: "GET" | "POST";
  body?: unknown;
  requestId?: string;
  /**
   * Override the default 30s upstream timeout. The browser-facing route
   * handler shouldn't be left hanging on a stuck Railway service —
   * surface the failure quickly so the UI can show a real error.
   */
  timeoutMs?: number;
  /**
   * Resilience policy overrides for this call. Defaults to a single attempt
   * so the existing public contract is preserved; callers must opt into
   * retries via `idempotent` or `idempotencyKey` (see `resilience.ts`).
   */
  resilience?: Partial<
    Pick<
      ResilienceOptions,
      | "maxAttempts"
      | "idempotent"
      | "idempotencyKey"
      | "baseDelayMs"
      | "maxDelayMs"
    >
  >;
}

type RawAnalysisResponse = {
  plant_id?: string;
  plantId?: string;
  image_id?: string;
  imageId?: string;
  overall_health_score?: number;
  overallHealthScore?: number;
  summary: string;
  findings: AnalysisResponse["findings"];
  compared_to_image_id?: string | null;
  comparedToImageId?: string | null;
  comparison_summary?: string | null;
  comparisonSummary?: string | null;
  analyzed_at?: string;
  analyzedAt?: string;
  model_version?: string;
  modelVersion?: string;
  analysis_mode?: "fallback" | "model";
  analysisMode?: "fallback" | "model";
  is_fallback?: boolean;
  isFallback?: boolean;
  fallback_reason?: string | null;
  fallbackReason?: string | null;
  request_id?: string;
  requestId?: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Proxy client for the Railway analysis service.
 * All calls go through Next.js server routes — the browser never calls
 * the analysis service directly.
 *
 * Wraps `fetch` in `withResilience` so timeouts, transport errors, and
 * retryable HTTP statuses are classified into a single `UpstreamError`
 * shape that route handlers can map onto the standard `apiError()`
 * envelope without leaking raw upstream messages.
 */
export async function callAnalysisService<T = unknown>(
  options: ProxyOptions,
): Promise<T> {
  const { url, apiKey } = getAnalysisServiceConfig();
  const {
    endpoint,
    method = "GET",
    body,
    requestId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    resilience,
  } = options;

  // Compute the effective request id once so headers, log lines, and
  // error messages all reference the same correlation key.
  const effectiveRequestId = requestId ?? crypto.randomUUID();

  // Wrap the resilient call in a per-instance circuit breaker keyed on the
  // upstream. Once the breaker opens, repeated calls from the same warm
  // instance fail fast with `UPSTREAM_UNAVAILABLE` until the cooldown
  // elapses — this prevents a request burst from amplifying load against a
  // known-bad analysis service.
  const breaker = getCircuitBreaker("analysis-service");
  try {
    return await breaker.run(() =>
      withResilience<T>(
        async (_attempt, signal) => {
          const init: RequestInit = {
            method,
            headers: withRequestIdHeader(
              {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              effectiveRequestId,
            ),
            signal,
          };
          if (body !== undefined) {
            init.body = JSON.stringify(body);
          }

          const response = await fetch(`${url}${endpoint}`, init);

          if (!response.ok) {
            // Drain (but do not surface) the upstream body so the connection
            // returns to the pool. The text is intentionally NOT included in
            // the thrown error — route handlers must not leak provider error
            // payloads to the browser.
            const drained = await response.text().catch(() => "");
            const upstreamRequestId =
              response.headers.get(REQUEST_ID_HEADER) ?? effectiveRequestId;
            const retryAfterHeader = response.headers.get("retry-after");
            const retryAfterSeconds =
              parseRetryAfter(retryAfterHeader) ?? undefined;
            const status = response.status;
            // Defer retry classification (retryable vs not) to withResilience
            // by leaving `retryable: false` and letting it consult the
            // `retryStatuses` allowlist — that way one allowlist governs
            // every upstream call.
            throw new UpstreamError({
              code:
                status === 429
                  ? "UPSTREAM_RATE_LIMITED"
                  : status >= 500
                    ? "UPSTREAM_UNAVAILABLE"
                    : "UPSTREAM_BAD_RESPONSE",
              message: `Analysis service error ${status} (request ${upstreamRequestId})`,
              operation: "analysis-service",
              requestId: effectiveRequestId,
              attempt: _attempt,
              retryable: false,
              status,
              ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
              // Capture the drained snippet on `cause` for server-side
              // debugging only — never echoed.
              cause: drained ? new Error(drained.slice(0, 500)) : undefined,
            });
          }

          return (await response.json()) as T;
        },
        {
          operation: "analysis-service",
          requestId: effectiveRequestId,
          timeoutMs,
          // Default to a single attempt; callers opt into retry by passing
          // `resilience.idempotent` or `resilience.idempotencyKey`. POST
          // /analyze must remain at maxAttempts=1 until the persistence layer
          // is made idempotent (see Phase 5 in the reliability plan).
          maxAttempts: resilience?.maxAttempts ?? 1,
          ...(resilience?.idempotent !== undefined
            ? { idempotent: resilience.idempotent }
            : {}),
          ...(resilience?.idempotencyKey !== undefined
            ? { idempotencyKey: resilience.idempotencyKey }
            : {}),
          ...(resilience?.baseDelayMs !== undefined
            ? { baseDelayMs: resilience.baseDelayMs }
            : {}),
          ...(resilience?.maxDelayMs !== undefined
            ? { maxDelayMs: resilience.maxDelayMs }
            : {}),
        },
      ),
    );
  } catch (err) {
    // Map a tripped circuit into the same UpstreamError shape as a real
    // upstream failure so the route handler doesn't need to special-case
    // breaker logic — it just sees an UPSTREAM_UNAVAILABLE with a
    // Retry-After hint.
    if (err instanceof CircuitOpenError) {
      throw new UpstreamError({
        code: "UPSTREAM_UNAVAILABLE",
        message: "Analysis service is temporarily unavailable.",
        operation: "analysis-service",
        requestId: effectiveRequestId,
        attempt: 0,
        retryable: true,
        retryAfterSeconds: err.retryAfterSeconds,
        cause: err,
      });
    }
    throw err;
  }
}

/** Parse an HTTP Retry-After value (seconds or HTTP-date) to seconds. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const asInt = Number.parseInt(trimmed, 10);
  if (Number.isFinite(asInt) && String(asInt) === trimmed) {
    return Math.max(0, asInt);
  }
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) {
    const delta = Math.ceil((asDate - Date.now()) / 1000);
    return delta > 0 ? delta : 0;
  }
  return null;
}

export function normalizeAnalysisResponse(
  payload: RawAnalysisResponse,
): AnalysisResponse {
  const normalized: AnalysisResponse = {
    plantId: payload.plantId ?? payload.plant_id ?? "",
    imageId: payload.imageId ?? payload.image_id ?? "",
    overallHealthScore:
      payload.overallHealthScore ?? payload.overall_health_score ?? 0,
    summary: payload.summary,
    findings: payload.findings,
    analyzedAt:
      payload.analyzedAt ?? payload.analyzed_at ?? new Date().toISOString(),
    modelVersion: payload.modelVersion ?? payload.model_version ?? "unknown",
  };

  const comparedToImageId =
    payload.comparedToImageId ?? payload.compared_to_image_id ?? null;
  if (comparedToImageId) {
    normalized.comparedToImageId = comparedToImageId;
  }

  const comparisonSummary =
    payload.comparisonSummary ?? payload.comparison_summary ?? null;
  if (comparisonSummary) {
    normalized.comparisonSummary = comparisonSummary;
  }

  const analysisMode = payload.analysisMode ?? payload.analysis_mode ?? null;
  if (analysisMode) {
    normalized.analysisMode = analysisMode;
  }

  if (payload.isFallback ?? payload.is_fallback) {
    normalized.isFallback = true;
  }

  const fallbackReason =
    payload.fallbackReason ?? payload.fallback_reason ?? null;
  if (fallbackReason) {
    normalized.fallbackReason = fallbackReason;
  }

  const requestId = payload.requestId ?? payload.request_id ?? null;
  if (requestId) {
    normalized.requestId = requestId;
  }

  return normalized;
}

/**
 * Grow context fields the Python analysis service understands. Sent on
 * the wire as snake_case to match `apps/analysis/app/models/analysis.py`.
 */
export interface AnalyzeGrowContext {
  growId: string;
  strain?: string;
  stage?: string;
  medium?: string;
  lightType?: string;
  daysSinceStart?: number;
  notes?: string;
}

/**
 * Submit a plant image for analysis.
 *
 * The TypeScript surface is camelCase to match `packages/shared` and the
 * rest of the web app. The HTTP body is serialised as snake_case because
 * the FastAPI service uses snake_case Pydantic field names with no
 * aliasing — sending camelCase causes a 422 validation error and the
 * user-facing analysis silently falls back. Keep this mapping explicit
 * (rather than a generic key transformer) so a contract change shows up
 * as a TypeScript error here.
 */
export async function analyzeImage(params: {
  plantId: string;
  imageId: string;
  storagePath: string;
  growContext: AnalyzeGrowContext;
  previousImageId?: string;
  previousStoragePath?: string;
  requestId?: string;
}): Promise<AnalysisResponse> {
  const growContext: Record<string, unknown> = {
    grow_id: params.growContext.growId,
  };
  if (params.growContext.strain !== undefined) {
    growContext["strain"] = params.growContext.strain;
  }
  if (params.growContext.stage !== undefined) {
    growContext["stage"] = params.growContext.stage;
  }
  if (params.growContext.medium !== undefined) {
    growContext["medium"] = params.growContext.medium;
  }
  if (params.growContext.lightType !== undefined) {
    growContext["light_type"] = params.growContext.lightType;
  }
  if (params.growContext.daysSinceStart !== undefined) {
    growContext["days_since_start"] = params.growContext.daysSinceStart;
  }
  if (params.growContext.notes !== undefined) {
    growContext["notes"] = params.growContext.notes;
  }

  const body: Record<string, unknown> = {
    plant_id: params.plantId,
    image_id: params.imageId,
    storage_path: params.storagePath,
    grow_context: growContext,
  };
  if (params.previousImageId !== undefined) {
    body["previous_image_id"] = params.previousImageId;
  }
  if (params.previousStoragePath !== undefined) {
    body["previous_storage_path"] = params.previousStoragePath;
  }

  const raw = await callAnalysisService<RawAnalysisResponse>({
    endpoint: "/analyze",
    method: "POST",
    body,
    ...(params.requestId ? { requestId: params.requestId } : {}),
    // POST /analyze is safe to retry: the persistence layer in
    // `runAndPersistPlantAnalysis` upserts on `image_id` (uniqueness
    // enforced by `plant_analyses.image_id UNIQUE` in migration 004) and
    // findings are deleted-and-replaced by `image_id` inside the same
    // function, so a retried call cannot create duplicate rows. The model
    // call itself is the only side effect that re-runs on retry — that's
    // acceptable cost for resilience against transient 5xx/timeouts.
    resilience: {
      maxAttempts: 2,
      idempotencyKey: `${params.plantId}:${params.imageId}`,
    },
  });
  return normalizeAnalysisResponse(raw);
}
