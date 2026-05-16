import "server-only";

/**
 * Configuration for the Railway-hosted analysis service.
 * These values are server-side only — never expose to the browser.
 */
export function getAnalysisServiceConfig() {
  const url = process.env["ANALYSIS_SERVICE_URL"];
  const apiKey = process.env["ANALYSIS_SERVICE_API_KEY"];
  const timeoutMs = Number.parseInt(
    process.env["ANALYSIS_SERVICE_TIMEOUT_MS"] ?? "30000",
    10,
  );

  if (!url || !apiKey) {
    throw new Error("Missing ANALYSIS_SERVICE_URL or ANALYSIS_SERVICE_API_KEY");
  }

  return {
    url,
    apiKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
  };
}
