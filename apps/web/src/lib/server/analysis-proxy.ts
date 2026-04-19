import "server-only";
import type { AnalysisFinding, AnalysisResponse } from "@phenosage/shared";
import { getAnalysisServiceConfig } from "./analysis-config";
import { createLogger } from "./logger";

interface ProxyOptions {
  endpoint: string;
  method?: "GET" | "POST";
  body?: unknown;
  requestId?: string;
  signal?: AbortSignal;
}

export class AnalysisServiceError extends Error {
  public readonly status: number;
  public readonly detail?: string;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "AnalysisServiceError";
    this.status = status;
    if (detail !== undefined) this.detail = detail;
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const log = createLogger({ component: "analysis-proxy" });

/**
 * Proxy client for the Railway analysis service.
 * All calls go through Next.js server routes — the browser never calls
 * the analysis service directly.
 */
export async function callAnalysisService<T = unknown>(
  options: ProxyOptions,
): Promise<T> {
  const { url, apiKey } = getAnalysisServiceConfig();
  const { endpoint, method = "GET", body, requestId, signal } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (requestId) headers["x-request-id"] = requestId;

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), DEFAULT_TIMEOUT_MS);
  init.signal = signal ?? timeout.signal;

  try {
    const response = await fetch(`${url}${endpoint}`, init);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      log.warn("analysis service error", {
        endpoint,
        status: response.status,
        requestId,
      });
      throw new AnalysisServiceError(
        `Analysis service error ${response.status}: ${text.slice(0, 500)}`,
        response.status,
        text.slice(0, 500),
      );
    }
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof AnalysisServiceError) throw err;
    const cause = err as { name?: string; message?: string };
    if (cause?.name === "AbortError") {
      throw new AnalysisServiceError("Analysis service timeout", 504);
    }
    throw new AnalysisServiceError(
      `Analysis service unreachable: ${cause?.message ?? "unknown"}`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

interface AnalyzeParams {
  plantId: string;
  imageId: string;
  storagePath: string;
  growContext: {
    growId: string;
    strain?: string | null;
    stage?: string | null;
    medium?: string | null;
    lightType?: string | null;
    daysSinceStart?: number | null;
    notes?: string | null;
  };
  previousImageId?: string;
  previousStoragePath?: string;
  requestId?: string;
}

interface RawAnalysisResponse {
  plant_id: string;
  image_id: string;
  overall_health_score: number;
  summary: string;
  findings: RawAnalysisFinding[];
  compared_to_image_id?: string | null;
  comparison_summary?: string | null;
  analyzed_at: string;
  model_version: string;
}

interface RawAnalysisFinding {
  category: AnalysisFinding["category"];
  severity: AnalysisFinding["severity"];
  title: string;
  description: string;
  recommendation?: string | null;
}

/**
 * Submit a plant image for analysis. Maps camelCase (web) ↔ snake_case (service).
 */
export async function analyzeImage(
  params: AnalyzeParams,
): Promise<AnalysisResponse> {
  const body = {
    plant_id: params.plantId,
    image_id: params.imageId,
    storage_path: params.storagePath,
    previous_image_id: params.previousImageId ?? null,
    previous_storage_path: params.previousStoragePath ?? null,
    grow_context: {
      grow_id: params.growContext.growId,
      strain: params.growContext.strain ?? null,
      stage: params.growContext.stage ?? null,
      medium: params.growContext.medium ?? null,
      light_type: params.growContext.lightType ?? null,
      days_since_start: params.growContext.daysSinceStart ?? null,
      notes: params.growContext.notes ?? null,
    },
  };

  const opts: ProxyOptions = { endpoint: "/analyze", method: "POST", body };
  if (params.requestId !== undefined) opts.requestId = params.requestId;
  const raw = await callAnalysisService<RawAnalysisResponse>(opts);

  return mapAnalysisResponse(raw);
}

export function mapAnalysisResponse(
  raw: RawAnalysisResponse,
): AnalysisResponse {
  const response: AnalysisResponse = {
    plantId: raw.plant_id,
    imageId: raw.image_id,
    overallHealthScore: raw.overall_health_score,
    summary: raw.summary,
    findings: raw.findings.map(mapFinding),
    analyzedAt: raw.analyzed_at,
    modelVersion: raw.model_version,
  };
  if (raw.compared_to_image_id) {
    response.comparedToImageId = raw.compared_to_image_id;
  }
  if (raw.comparison_summary) {
    response.comparisonSummary = raw.comparison_summary;
  }
  return response;
}

function mapFinding(raw: RawAnalysisFinding): AnalysisFinding {
  const finding: AnalysisFinding = {
    category: raw.category,
    severity: raw.severity,
    title: raw.title,
    description: raw.description,
  };
  if (raw.recommendation) finding.recommendation = raw.recommendation;
  return finding;
}
