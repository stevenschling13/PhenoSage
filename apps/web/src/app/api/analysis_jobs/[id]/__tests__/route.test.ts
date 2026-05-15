import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getAnalysisJob = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));
vi.mock("@/lib/server/analysis-jobs", () => ({
  getAnalysisJob: (...args: unknown[]) => getAnalysisJob(...args),
}));

import { GET } from "../route";

const JOB_ID = "33333333-3333-4333-8333-333333333333";

function request() {
  return new NextRequest(`http://localhost/api/analysis_jobs/${JOB_ID}`);
}

function params(id = JOB_ID) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/analysis_jobs/[id]", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getAnalysisJob as Mock).mockReset();
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
    getAnalysisJob.mockResolvedValue({
      id: JOB_ID,
      plantId: "p1",
      imageId: "i1",
      status: "queued",
      attemptCount: 0,
      maxAttempts: 3,
      queuedAt: "2026-05-15T00:00:00Z",
      startedAt: null,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      resultAnalysisId: null,
    });
    const res = await GET(request(), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.job_id).toBe(JOB_ID);
    expect(body.data.status).toBe("queued");
  });
});
