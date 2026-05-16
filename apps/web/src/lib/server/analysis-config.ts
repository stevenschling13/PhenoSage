import "server-only";

/**
 * Configuration for the Railway-hosted analysis service.
 * These values are server-side only — never expose to the browser.
 */
export function getAnalysisServiceConfig() {
  const url = process.env["ANALYSIS_SERVICE_URL"];
  const apiKey = process.env["ANALYSIS_SERVICE_API_KEY"];

  if (!url || !apiKey) {
    throw new Error("Missing ANALYSIS_SERVICE_URL or ANALYSIS_SERVICE_API_KEY");
  }

  return { url, apiKey };
}
