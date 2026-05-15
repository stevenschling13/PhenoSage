import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAnalysisServiceConfig } from "../analysis-config";

const ORIGINAL_ENV = process.env;

describe("getAnalysisServiceConfig", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns url + apiKey when both env vars are set", () => {
    process.env["ANALYSIS_SERVICE_URL"] = "https://analysis.example.com";
    process.env["ANALYSIS_SERVICE_API_KEY"] = "key-123";
    expect(getAnalysisServiceConfig()).toEqual({
      url: "https://analysis.example.com",
      apiKey: "key-123",
      timeoutMs: 30000,
    });
  });

  it("reads an optional positive timeout override", () => {
    process.env["ANALYSIS_SERVICE_URL"] = "https://analysis.example.com";
    process.env["ANALYSIS_SERVICE_API_KEY"] = "key-123";
    process.env["ANALYSIS_SERVICE_TIMEOUT_MS"] = "7500";
    expect(getAnalysisServiceConfig().timeoutMs).toBe(7500);
  });

  it("throws when ANALYSIS_SERVICE_URL is missing", () => {
    delete process.env["ANALYSIS_SERVICE_URL"];
    process.env["ANALYSIS_SERVICE_API_KEY"] = "key-123";
    expect(() => getAnalysisServiceConfig()).toThrow(/ANALYSIS_SERVICE_URL/);
  });

  it("throws when ANALYSIS_SERVICE_API_KEY is missing", () => {
    process.env["ANALYSIS_SERVICE_URL"] = "https://analysis.example.com";
    delete process.env["ANALYSIS_SERVICE_API_KEY"];
    expect(() => getAnalysisServiceConfig()).toThrow(
      /ANALYSIS_SERVICE_API_KEY/,
    );
  });
});
