import "server-only";
import type { AnalysisResponse } from "@phenosage/shared";
import { getAnalysisServiceConfig } from "./analysis-config";

interface ProxyOptions {
  endpoint: string;
  method?: "GET" | "POST";
  body?: unknown;
}

/**
 * Proxy client for the Railway analysis service.
 * All calls go through Next.js server routes — the browser never calls
 * the analysis service directly.
 */
export async function callAnalysisService<T = unknown>(
  options: ProxyOptions,
): Promise<T> {
  const { url, apiKey } = getAnalysisServiceConfig();
  const { endpoint, method = "GET", body } = options;

  const response = await fetch(`${url}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Analysis service error ${response.status}: ${text}`,
    );
  }

  return response.json() as Promise<T>;
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
}): Promise<AnalysisResponse> {
  return callAnalysisService<AnalysisResponse>({
    endpoint: "/analyze",
    method: "POST",
    body: params,
  });
}
