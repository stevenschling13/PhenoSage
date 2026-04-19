import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  AnalysisServiceError,
  analyzeImage,
  callAnalysisService,
  mapAnalysisResponse,
} from "../analysis-proxy";

const ORIGINAL_ENV = process.env;

describe("analysis-proxy", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      ANALYSIS_SERVICE_URL: "https://analysis.example.com",
      ANALYSIS_SERVICE_API_KEY: "test-key",
    };
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    fetchSpy.mockRestore();
  });

  function mockOk<T>(body: T): void {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  it("issues an authenticated GET without a body", async () => {
    mockOk({ ok: true });
    await callAnalysisService({ endpoint: "/status" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://analysis.example.com/status");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
  });

  it("propagates x-request-id when provided", async () => {
    mockOk({ ok: true });
    await callAnalysisService({ endpoint: "/status", requestId: "req-123" });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-request-id"]).toBe(
      "req-123",
    );
  });

  it("serializes the body on POST", async () => {
    mockOk({ ok: true });
    await callAnalysisService({
      endpoint: "/do",
      method: "POST",
      body: { a: 1 },
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
  });

  it("analyzeImage sends snake_case and maps snake_case response to camelCase", async () => {
    mockOk({
      plant_id: "p1",
      image_id: "i1",
      overall_health_score: 80,
      summary: "healthy",
      findings: [
        {
          category: "positive",
          severity: "info",
          title: "Healthy",
          description: "Looks good",
          recommendation: null,
        },
      ],
      compared_to_image_id: null,
      comparison_summary: null,
      analyzed_at: "2026-04-01T00:00:00Z",
      model_version: "v1",
    });

    const result = await analyzeImage({
      plantId: "p1",
      imageId: "i1",
      storagePath: "plants/p1/i1.jpg",
      growContext: { growId: "g1", stage: "vegetative" },
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://analysis.example.com/analyze");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent["plant_id"]).toBe("p1");
    expect(sent["image_id"]).toBe("i1");
    expect(sent["storage_path"]).toBe("plants/p1/i1.jpg");
    expect((sent["grow_context"] as Record<string, unknown>)["grow_id"]).toBe(
      "g1",
    );

    expect(result.plantId).toBe("p1");
    expect(result.imageId).toBe("i1");
    expect(result.overallHealthScore).toBe(80);
    expect(result.findings[0]?.category).toBe("positive");
    expect(result.comparedToImageId).toBeUndefined();
  });

  it("mapAnalysisResponse preserves comparison fields when present", () => {
    const mapped = mapAnalysisResponse({
      plant_id: "p1",
      image_id: "i2",
      overall_health_score: 90,
      summary: "improved",
      findings: [],
      compared_to_image_id: "i1",
      comparison_summary: "less yellow",
      analyzed_at: "2026-04-01T00:00:00Z",
      model_version: "v1",
    });
    expect(mapped.comparedToImageId).toBe("i1");
    expect(mapped.comparisonSummary).toBe("less yellow");
  });

  it("throws AnalysisServiceError with status code when the upstream errors", async () => {
    fetchSpy.mockResolvedValue(new Response("boom", { status: 502 }));
    await expect(
      callAnalysisService({ endpoint: "/broken" }),
    ).rejects.toBeInstanceOf(AnalysisServiceError);
  });

  it("wraps network errors as AnalysisServiceError(502)", async () => {
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
    await expect(callAnalysisService({ endpoint: "/x" })).rejects.toMatchObject(
      { status: 502 },
    );
  });
});
