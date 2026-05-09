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

  it("analyzeImage calls /analyze with the expected payload", async () => {
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
      growContext: { stage: "vegetative" },
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://analysis.example.com/analyze");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      plantId: "p1",
      imageId: "i1",
    });
  });

  it("throws with status code when the upstream errors", async () => {
    fetchSpy.mockResolvedValue(new Response("boom", { status: 502 }));
    await expect(callAnalysisService({ endpoint: "/broken" })).rejects.toThrow(
      /502/,
    );
  });

  it("attaches an abort signal so the fetch can time out", async () => {
    mockOk({ ok: true });
    await callAnalysisService({ endpoint: "/status" });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("surfaces a friendly timeout error when the upstream hangs", async () => {
    const timeoutError = new Error("operation timed out");
    timeoutError.name = "TimeoutError";
    fetchSpy.mockRejectedValue(timeoutError);
    await expect(
      callAnalysisService({
        endpoint: "/slow",
        requestId: "req-123",
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/timed out after 5000ms.*req-123/);
  });
});
