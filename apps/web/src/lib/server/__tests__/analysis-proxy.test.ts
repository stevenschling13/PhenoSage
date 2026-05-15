import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { analyzeImage, callAnalysisService } from "../analysis-proxy";

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
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer test-key",
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

  it("analyzeImage serializes the body as snake_case for FastAPI", async () => {
    mockOk({
      plantId: "p1",
      imageId: "i1",
      overallHealthScore: 80,
      summary: "",
      findings: [],
      analyzedAt: "2026-04-01T00:00:00Z",
      modelVersion: "v1",
    });
    await analyzeImage({
      plantId: "p1",
      imageId: "i1",
      storagePath: "plants/p1/i1.jpg",
      growContext: {
        growId: "g1",
        stage: "vegetative",
        lightType: "led",
        daysSinceStart: 14,
      },
      previousImageId: "i0",
      previousStoragePath: "plants/p1/i0.jpg",
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://analysis.example.com/analyze");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      plant_id: "p1",
      image_id: "i1",
      storage_path: "plants/p1/i1.jpg",
      previous_image_id: "i0",
      previous_storage_path: "plants/p1/i0.jpg",
      grow_context: {
        grow_id: "g1",
        stage: "vegetative",
        light_type: "led",
        days_since_start: 14,
      },
    });
    // No camelCase keys leak through — those would 422 against the
    // Python AnalyzeRequest model.
    expect(sent).not.toHaveProperty("plantId");
    expect(sent).not.toHaveProperty("imageId");
    expect(sent).not.toHaveProperty("growContext");
  });

  it("omits optional grow_context fields that weren't provided", async () => {
    mockOk({
      plantId: "p1",
      imageId: "i1",
      overallHealthScore: 0,
      summary: "",
      findings: [],
      analyzedAt: "2026-04-01T00:00:00Z",
      modelVersion: "v1",
    });
    await analyzeImage({
      plantId: "p1",
      imageId: "i1",
      storagePath: "plants/p1/i1.jpg",
      growContext: { growId: "g1" },
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as {
      grow_context: Record<string, unknown>;
    };
    expect(Object.keys(sent.grow_context)).toEqual(["grow_id"]);
  });

  it("normalizes snake_case finding confidence from the analysis service", async () => {
    mockOk({
      plant_id: "p1",
      image_id: "i1",
      overall_health_score: 88,
      summary: "Healthy overall.",
      findings: [
        {
          category: "positive",
          severity: "info",
          confidence_score: 0.87,
          title: "Healthy posture",
          description: "Leaves are praying upward.",
          recommendation: "Hold the current environment steady.",
        },
      ],
      analyzed_at: "2026-04-01T00:00:00Z",
      model_version: "v1",
    });

    const result = await analyzeImage({
      plantId: "p1",
      imageId: "i1",
      storagePath: "plants/p1/i1.jpg",
      growContext: { growId: "g1" },
    });

    expect(result.findings[0]).toMatchObject({
      confidenceScore: 0.87,
      recommendation: "Hold the current environment steady.",
    });
  });

  it("throws an UpstreamError with the upstream status when the upstream errors", async () => {
    fetchSpy.mockResolvedValue(new Response("boom", { status: 502 }));
    await expect(callAnalysisService({ endpoint: "/broken" })).rejects.toThrow(
      /502/,
    );
  });

  it("does not echo the upstream response body in the thrown error message", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ secret_token: "sk_live_should_never_leak" }),
        { status: 500 },
      ),
    );
    let caught: Error | null = null;
    try {
      await callAnalysisService({ endpoint: "/broken" });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toMatch(/500/);
    // The drained body lives on `cause` (server-only debugging only) but
    // must NOT appear in the user-facing message — route handlers surface
    // the message through apiError().
    expect(caught?.message).not.toMatch(/sk_live_should_never_leak/);
  });

  it("attaches an abort signal so the fetch can time out", async () => {
    mockOk({ ok: true });
    await callAnalysisService({ endpoint: "/status" });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("classifies a TimeoutError into a typed UPSTREAM_TIMEOUT", async () => {
    const timeoutError = new Error("operation timed out");
    timeoutError.name = "TimeoutError";
    fetchSpy.mockRejectedValue(timeoutError);
    await expect(
      callAnalysisService({
        endpoint: "/slow",
        requestId: "req-123",
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({
      name: "UpstreamError",
      code: "UPSTREAM_TIMEOUT",
      retryable: true,
      requestId: "req-123",
    });
  });
});
