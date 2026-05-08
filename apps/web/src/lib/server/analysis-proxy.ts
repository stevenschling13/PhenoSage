import "server-only";
import type { AnalysisResponse } from "@phenosage/shared";
import { z } from "zod";
import { getAnalysisServiceConfig } from "./analysis-config";
import { logServerEvent } from "./request-id";
import { REQUEST_ID_HEADER, withRequestIdHeader } from "./request-id";

interface ProxyOptions {
  endpoint: string;
  method?: "GET" | "POST";
  body?: unknown;
  requestId?: string;
}
const DEFAULT_TIMEOUT_MS = 15_000;
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

const RawAnalysisResponseSchema = z.object({
  plant_id: z.string().optional(),
  plantId: z.string().optional(),
  image_id: z.string().optional(),
  imageId: z.string().optional(),
  overall_health_score: z.number().optional(),
  overallHealthScore: z.number().optional(),
  summary: z.string(),
  findings: z.custom<AnalysisResponse["findings"]>(),
  compared_to_image_id: z.string().nullable().optional(),
  comparedToImageId: z.string().nullable().optional(),
  comparison_summary: z.string().nullable().optional(),
  comparisonSummary: z.string().nullable().optional(),
  analyzed_at: z.string().optional(),
  analyzedAt: z.string().optional(),
  model_version: z.string().optional(),
  modelVersion: z.string().optional(),
  analysis_mode: z.enum(["fallback", "model"]).optional(),
  analysisMode: z.enum(["fallback", "model"]).optional(),
  is_fallback: z.boolean().optional(),
  isFallback: z.boolean().optional(),
  fallback_reason: z.string().nullable().optional(),
  fallbackReason: z.string().nullable().optional(),
  request_id: z.string().optional(),
  requestId: z.string().optional(),
});

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

  const timeoutMs = Number(
    process.env["ANALYSIS_SERVICE_TIMEOUT_MS"] ?? DEFAULT_TIMEOUT_MS,
  );
  let attempt = 0;
  let response: Response | null = null;

  while (attempt < 2) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(`${url}${endpoint}`, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (
        response.ok ||
        !RETRYABLE_STATUS_CODES.has(response.status) ||
        method !== "POST"
      ) {
        break;
      }
      attempt += 1;
      continue;
    } catch (error) {
      clearTimeout(timer);
      if (
        attempt === 0 &&
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        attempt += 1;
        continue;
      }
      throw error;
    }
  }

  if (!response) {
    throw new Error("Analysis service did not return a response");
  }

  if (!response.ok) {
    const upstreamRequestId =
      response.headers.get(REQUEST_ID_HEADER) ?? requestId ?? "unknown";
    throw new Error(
      `Analysis service error ${response.status} (request ${upstreamRequestId})`,
    );
  }

  logServerEvent("info", "analysis service call completed", {
    endpoint,
    method,
    status: response.status,
    requestId,
  });
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
  const parsed = RawAnalysisResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Analysis service returned an invalid response shape");
  }
  return normalizeAnalysisResponse(parsed.data as RawAnalysisResponse);
}
