import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getAnalysisJob = vi.fn();
const completeAnalysisJob = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));
vi.mock("@/lib/server/analysis-jobs", () => ({
  getAnalysisJob: (...args: unknown[]) => getAnalysisJob(...args),
  completeAnalysisJob: (...args: unknown[]) => completeAnalysisJob(...args),
  isTerminalAnalysisJobStatus: (status: string) =>
    ["succeeded", "failed", "cancelled"].includes(status),
}));

import { GET } from "../route";

const JOB_ID = "33333333-3333-4333-8333-333333333333";

function request() {
  return new NextRequest(`http://localhost/api/analysis_jobs/${JOB_ID}`);
}

function params(id = JOB_ID) {
  return { params: Promise.resolve({ id }) };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    plantId: "p1",
    imageId: "i1",
    status: "queued",
    attemptCount: 0,
    maxAttempts: 3,
    queuedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
    resultAnalysisId: null,
    ...overrides,
  };
}

describe("GET /api/analysis_jobs/[id]", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getAnalysisJob as Mock).mockReset();
    (completeAnalysisJob as Mock).mockReset();
  });

  it("requires authentication", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET(request(), params());
    expect(res.status).toBe(401);
  });

  it("validates the job id", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await GET(request(), params("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(getAnalysisJob).not.toHaveBeenCalled();
  });

  it("returns job status", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getAnalysisJob.mockResolvedValue(job());
    const res = await GET(request(), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.job_id).toBe(JOB_ID);
    expect(body.data.status).toBe("queued");
    expect(completeAnalysisJob).not.toHaveBeenCalled();
  });

  it("reaps a non-terminal job stuck past the stale window", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const staleStartedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    getAnalysisJob.mockResolvedValue(
      job({ status: "running", startedAt: staleStartedAt, attemptCount: 1 }),
    );
    completeAnalysisJob.mockResolvedValue({
      kind: "updated",
      job: job({
        status: "failed",
        startedAt: staleStartedAt,
        errorCode: "stale_timeout",
        errorMessage:
          "Analysis timed out. Try again from the plant page in a few minutes.",
      }),
    });

    const res = await GET(request(), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("failed");
    expect(body.data.error_code).toBe("stale_timeout");
    expect(completeAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: JOB_ID,
        status: "failed",
        errorCode: "stale_timeout",
      }),
    );
  });

  it("does not reap a terminal job no matter how old", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getAnalysisJob.mockResolvedValue(
      job({
        status: "succeeded",
        queuedAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:01:00Z",
        resultAnalysisId: "a1",
      }),
    );
    const res = await GET(request(), params());
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("succeeded");
    expect(completeAnalysisJob).not.toHaveBeenCalled();
  });

  it("does not reap a fresh in-flight job", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getAnalysisJob.mockResolvedValue(
      job({ status: "running", startedAt: new Date().toISOString() }),
    );
    const res = await GET(request(), params());
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("running");
    expect(completeAnalysisJob).not.toHaveBeenCalled();
  });
});
