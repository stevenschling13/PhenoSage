import "server-only";
import type { AnalysisResponse } from "@phenosage/shared";
import { getAnalysisServiceConfig } from "./analysis-config";
import { REQUEST_ID_HEADER, withRequestIdHeader } from "./request-id";

interface ProxyOptions {
  endpoint: string;
  method?: "GET" | "POST";
  body?: unknown;
  requestId?: string;
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

/**
 * Proxy client for the Railway analysis service.
 * All calls go through Next.js server routes — the browser never calls
 * the analysis service directly.
 */
export async function callAnalysisService<T = unknown>(
  options: ProxyOptions,
): Promise<T> {
  const { url, apiKey } = getAnalysisServiceConfig();
  const { endpoint, method = "GET", body, requestId } = options;

  const init: RequestInit = {
    method,
    headers: withRequestIdHeader(
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      requestId ?? crypto.randomUUID(),
    ),
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const response = await fetch(`${url}${endpoint}`, init);

  if (!response.ok) {
    const text = await response.text();
    const upstreamRequestId =
      response.headers.get(REQUEST_ID_HEADER) ?? requestId ?? "unknown";
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
 * Submit a plant image for analysis.
 */
export async function analyzeImage(params: {
  plantId: string;
  imageId: string;
  storagePath: string;
  growContext: Record<string, unknown>;
  previousImageId?: string;
  previousStoragePath?: string;
  requestId?: string;
}): Promise<AnalysisResponse> {
  const raw = await callAnalysisService<RawAnalysisResponse>({
    endpoint: "/analyze",
    method: "POST",
    body: params,
    ...(params.requestId ? { requestId: params.requestId } : {}),
  });
  return normalizeAnalysisResponse(raw);
}
