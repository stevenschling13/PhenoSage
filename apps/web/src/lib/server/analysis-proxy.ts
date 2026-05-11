import "server-only";
import type { AnalysisResponse } from "@phenosage/shared";
import { getAnalysisServiceConfig } from "./analysis-config";
import { REQUEST_ID_HEADER, withRequestIdHeader } from "./request-id";

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
  } = options;

  // Compute the effective request id once so headers, log lines, and
  // error messages all reference the same correlation key.
  const effectiveRequestId = requestId ?? crypto.randomUUID();

  const init: RequestInit = {
    method,
    headers: withRequestIdHeader(
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      effectiveRequestId,
    ),
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${url}${endpoint}`, init);
  } catch (err) {
    // AbortSignal.timeout fires a TimeoutError DOMException; surface a
    // distinct message so callers + Sentry can tell a hung upstream
    // apart from a regular fetch failure. Carry the underlying error as
    // `cause` so debuggers still see the original stack.
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(
        `Analysis service timed out after ${timeoutMs}ms (request ${effectiveRequestId})`,
        { cause: err },
      );
    }
    throw err;
  }

  if (!response.ok) {
    const text = await response.text();
    const upstreamRequestId =
      response.headers.get(REQUEST_ID_HEADER) ?? effectiveRequestId;
    throw new Error(
      `Analysis service error ${response.status} (request ${upstreamRequestId}): ${text}`,
    );
  }

  return response.json() as Promise<T>;
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
  });
  return normalizeAnalysisResponse(raw);
}
