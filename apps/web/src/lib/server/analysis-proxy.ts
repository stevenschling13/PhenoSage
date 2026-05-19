import "server-only";
import type {
  AnalysisResponse,
  ImageComparisonResult,
  UniformityDelta,
} from "@phenosage/shared";
import { getAnalysisServiceConfig } from "./analysis-config";
import { CircuitOpenError, getCircuitBreaker } from "./circuit-breaker";
import { REQUEST_ID_HEADER, withRequestIdHeader } from "./request-id";
import {
  UpstreamError,
  withResilience,
  type ResilienceOptions,
} from "./resilience";
import { TRACEPARENT_HEADER } from "./trace-context";

interface ProxyOptions {
  endpoint: string;
  method?: "GET" | "POST";
  body?: unknown;
  requestId?: string;
  /**
   * W3C `traceparent` value to forward to the analysis service so a
   * single trace id grep-correlates web logs with analysis logs
   * end-to-end. When omitted the call still works — the analysis
   * service will start a fresh trace on its side — but the two
   * sides won't share a trace id. Route handlers obtain this from
   * `withRouteLogging`'s trace context (or `traceContextFromRequest`).
   */
  traceparent?: string;
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
  findings: RawAnalysisFinding[];
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

type RawAnalysisFinding = {
  category: AnalysisResponse["findings"][number]["category"];
  severity: AnalysisResponse["findings"][number]["severity"];
  confidence_score?: number | null;
  confidenceScore?: number | null;
  title: string;
  description: string;
  recommendation?: string | null;
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
  const {
    url,
    apiKey,
    timeoutMs: configuredTimeoutMs,
  } = getAnalysisServiceConfig();
  const {
    endpoint,
    method = "GET",
    body,
    requestId,
    traceparent,
    timeoutMs = configuredTimeoutMs || DEFAULT_TIMEOUT_MS,
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
          const headers = new Headers(
            withRequestIdHeader(
              {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              effectiveRequestId,
            ),
          );
          // Forward W3C `traceparent` so the analysis service can
          // continue the trace on its side. We pass the value
          // through verbatim — the route handler is the span owner
          // and built the header; we're just on the wire here.
          if (traceparent) {
            headers.set(TRACEPARENT_HEADER, traceparent);
          }
          const init: RequestInit = {
            method,
            headers,
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
          // Default to a single attempt; per-call retry policy is opt-in
          // via `resilience.maxAttempts` paired with `idempotent` or
          // `idempotencyKey`. `analyzeImage` (below) opts in because the
          // persistence layer in `runAndPersistPlantAnalysis` is
          // idempotent on `image_id` (UNIQUE constraint from migration
          // 004 + delete-and-replace findings).
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
    findings: payload.findings.map(normalizeFinding),
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

function normalizeFinding(
  finding: RawAnalysisFinding,
): AnalysisResponse["findings"][number] {
  const normalized: AnalysisResponse["findings"][number] = {
    category: finding.category,
    severity: finding.severity,
    title: finding.title,
    description: finding.description,
  };

  const recommendation = finding.recommendation ?? null;
  if (recommendation) {
    normalized.recommendation = recommendation;
  }

  const confidenceScore = finding.confidenceScore ?? finding.confidence_score;
  if (typeof confidenceScore === "number") {
    normalized.confidenceScore = confidenceScore;
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
  /**
   * W3C `traceparent` for the analysis-service hop. Pass the value
   * the calling route built via `traceContextFromRequest(request)`
   * so the two services share a trace id in their logs.
   */
  traceparent?: string;
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
    ...(params.traceparent ? { traceparent: params.traceparent } : {}),
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

// --- Image comparison ("What Changed?") -------------------------------

type RawCompareResponse = {
  plant_id?: string;
  plantId?: string;
  image_id_current?: string;
  imageIdCurrent?: string;
  image_id_previous?: string;
  imageIdPrevious?: string;
  summary: string;
  bullets: string[];
  uniformity_delta?: UniformityDelta;
  uniformityDelta?: UniformityDelta;
  confidence: number;
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

function normalizeCompareResponse(
  payload: RawCompareResponse,
): ImageComparisonResult {
  const result: ImageComparisonResult = {
    plantId: payload.plantId ?? payload.plant_id ?? "",
    imageIdCurrent: payload.imageIdCurrent ?? payload.image_id_current ?? "",
    imageIdPrevious: payload.imageIdPrevious ?? payload.image_id_previous ?? "",
    summary: payload.summary,
    bullets: Array.isArray(payload.bullets) ? payload.bullets : [],
    uniformityDelta:
      payload.uniformityDelta ?? payload.uniformity_delta ?? "unknown",
    confidence: typeof payload.confidence === "number" ? payload.confidence : 0,
    analyzedAt:
      payload.analyzedAt ?? payload.analyzed_at ?? new Date().toISOString(),
    modelVersion: payload.modelVersion ?? payload.model_version ?? "unknown",
  };
  const analysisMode = payload.analysisMode ?? payload.analysis_mode ?? null;
  if (analysisMode) {
    result.analysisMode = analysisMode;
  }
  if (payload.isFallback ?? payload.is_fallback) {
    result.isFallback = true;
  }
  const fallbackReason =
    payload.fallbackReason ?? payload.fallback_reason ?? null;
  if (fallbackReason) {
    result.fallbackReason = fallbackReason;
  }
  const requestId = payload.requestId ?? payload.request_id ?? null;
  if (requestId) {
    result.requestId = requestId;
  }
  return result;
}

/**
 * Compare the two most recent images for a plant and return a structured
 * "what changed?" payload. Safe to retry: the FastAPI side is idempotent
 * (no DB writes happen on /compare, only the vision call repeats).
 */
export async function compareImages(params: {
  plantId: string;
  imageIdCurrent: string;
  storagePathCurrent: string;
  imageIdPrevious: string;
  storagePathPrevious: string;
  growContext: AnalyzeGrowContext;
  requestId?: string;
  traceparent?: string;
}): Promise<ImageComparisonResult> {
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
    image_id_current: params.imageIdCurrent,
    storage_path_current: params.storagePathCurrent,
    image_id_previous: params.imageIdPrevious,
    storage_path_previous: params.storagePathPrevious,
    grow_context: growContext,
  };

  const raw = await callAnalysisService<RawCompareResponse>({
    endpoint: "/compare",
    method: "POST",
    body,
    ...(params.requestId ? { requestId: params.requestId } : {}),
    ...(params.traceparent ? { traceparent: params.traceparent } : {}),
    // /compare has no persisted side effects on either side — every retry
    // is identical, idempotent, and safe to attempt again on transient
    // 5xx/timeouts. We pay a vision call per retry; the bounded
    // maxAttempts caps that cost.
    resilience: {
      maxAttempts: 2,
      idempotencyKey: `compare:${params.plantId}:${params.imageIdCurrent}:${params.imageIdPrevious}`,
    },
  });
  return normalizeCompareResponse(raw);
}
