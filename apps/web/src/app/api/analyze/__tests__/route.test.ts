import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const enqueueAnalysisJob = vi.fn();
const rateLimit = vi.fn();
const rateLimitKeyFromRequest = vi.fn();
const executeAnalysisJob = vi.fn();
const afterTasks: Array<() => unknown> = [];

// `after()` requires a live request scope, which vitest's direct handler
// invocation does not provide — capture tasks so tests can run them.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: () => unknown) => {
      afterTasks.push(task);
    },
  };
});

vi.mock("@/lib/server/analysis-job-runner", () => ({
  executeAnalysisJob: (...args: unknown[]) => executeAnalysisJob(...args),
}));

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("@/lib/server/analysis-jobs", () => ({
  ANALYSIS_DAILY_LIMIT_PER_USER: 50,
  ANALYSIS_DAILY_WINDOW_MS: 24 * 60 * 60 * 1000,
  enqueueAnalysisJob: (...args: unknown[]) => enqueueAnalysisJob(...args),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitKeyFromRequest: (...args: unknown[]) =>
    rateLimitKeyFromRequest(...args),
}));

import { POST } from "../route";

const PLANT_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/analyze", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getServerUser as Mock).mockReset();
    (enqueueAnalysisJob as Mock).mockReset();
    (rateLimit as Mock).mockReset();
    (rateLimitKeyFromRequest as Mock).mockReset();
    (executeAnalysisJob as Mock).mockReset();
    afterTasks.length = 0;
    getServerUser.mockResolvedValue({ id: "u1" });
    rateLimit.mockResolvedValue({ ok: true });
    rateLimitKeyFromRequest.mockReturnValue("k");
  });

  it("requires authentication", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(request({ plant_id: PLANT_ID, image_id: IMAGE_ID }));
    expect(res.status).toBe(401);
    expect(enqueueAnalysisJob).not.toHaveBeenCalled();
  });

  it("returns 429 with daily-cap copy when the daily quota is exhausted", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    rateLimit
      .mockResolvedValueOnce({ ok: true }) // burst window
      .mockResolvedValueOnce({ ok: false }); // daily window
    const res = await POST(request({ plant_id: PLANT_ID, image_id: IMAGE_ID }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.message).toMatch(/Daily analysis limit/);
    expect(rateLimit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        key: expect.stringMatching(/^analyze-daily:/),
      }),
    );
    expect(enqueueAnalysisJob).not.toHaveBeenCalled();
  });

  it("validates the request body", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(request({ plant_id: PLANT_ID }));
    expect(res.status).toBe(422);
    expect(enqueueAnalysisJob).not.toHaveBeenCalled();
  });

  it("enqueues and returns a job id", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    enqueueAnalysisJob.mockResolvedValue({
      id: JOB_ID,
      plantId: PLANT_ID,
      imageId: IMAGE_ID,
      status: "queued",
    });
    const res = await POST(request({ plant_id: PLANT_ID, image_id: IMAGE_ID }));
    expect(res.status).toBe(202);
    expect((await res.json()).data.job_id).toBe(JOB_ID);
    expect(enqueueAnalysisJob).toHaveBeenCalledWith({
      plantId: PLANT_ID,
      imageId: IMAGE_ID,
    });
  });

  it("schedules background execution of the enqueued job via after()", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const job = {
      id: JOB_ID,
      plantId: PLANT_ID,
      imageId: IMAGE_ID,
      status: "queued",
    };
    enqueueAnalysisJob.mockResolvedValue(job);
    const res = await POST(request({ plant_id: PLANT_ID, image_id: IMAGE_ID }));
    expect(res.status).toBe(202);

    expect(afterTasks).toHaveLength(1);
    expect(executeAnalysisJob).not.toHaveBeenCalled();
    await afterTasks[0]?.();
    expect(executeAnalysisJob).toHaveBeenCalledWith(job, expect.any(String));
  });

  it("does not schedule execution when enqueue fails", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    enqueueAnalysisJob.mockResolvedValue(null);
    const res = await POST(request({ plant_id: PLANT_ID, image_id: IMAGE_ID }));
    expect(res.status).toBe(404);
    expect(afterTasks).toHaveLength(0);
  });
});
