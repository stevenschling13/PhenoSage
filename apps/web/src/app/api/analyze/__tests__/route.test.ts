import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const enqueueAnalysisJob = vi.fn();
const rateLimit = vi.fn();
const rateLimitKeyFromRequest = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("@/lib/server/analysis-jobs", () => ({
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
});
