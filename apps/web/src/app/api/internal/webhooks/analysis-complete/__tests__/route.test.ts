import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { NextRequest } from "next/server";

const completeAnalysisJob = vi.fn();

vi.mock("@/lib/server/analysis-jobs", () => ({
  completeAnalysisJob: (...args: unknown[]) => completeAnalysisJob(...args),
}));

import { POST } from "../route";
import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  computeWebhookSignature,
} from "@/lib/server/webhook-signature";

const SECRET = "test-secret-32-bytes-minimum-padding-1234";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const ANALYSIS_ID = "44444444-4444-4444-8444-444444444444";

function buildRequest(body: object | string, secret = SECRET) {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = computeWebhookSignature(rawBody, ts, secret);
  return new NextRequest(
    "http://localhost/api/internal/webhooks/analysis-complete",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [WEBHOOK_SIGNATURE_HEADER]: sig,
        [WEBHOOK_TIMESTAMP_HEADER]: ts,
      },
      body: rawBody,
    },
  );
}

describe("POST /api/internal/webhooks/analysis-complete", () => {
  const originalSecret = process.env["ANALYSIS_WEBHOOK_SECRET"];

  beforeEach(() => {
    (completeAnalysisJob as Mock).mockReset();
    process.env["ANALYSIS_WEBHOOK_SECRET"] = SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env["ANALYSIS_WEBHOOK_SECRET"];
    } else {
      process.env["ANALYSIS_WEBHOOK_SECRET"] = originalSecret;
    }
  });

  it("returns 503 when the webhook secret is not configured", async () => {
    delete process.env["ANALYSIS_WEBHOOK_SECRET"];
    const req = new NextRequest(
      "http://localhost/api/internal/webhooks/analysis-complete",
      { method: "POST", body: "{}" },
    );
    const res = await POST(req);
    expect(res.status).toBe(503);
    expect(completeAnalysisJob).not.toHaveBeenCalled();
  });

  it("returns 401 when the signature is missing", async () => {
    const req = new NextRequest(
      "http://localhost/api/internal/webhooks/analysis-complete",
      {
        method: "POST",
        body: JSON.stringify({ jobId: JOB_ID, status: "succeeded" }),
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(completeAnalysisJob).not.toHaveBeenCalled();
  });

  it("returns 401 when the signature is wrong", async () => {
    const req = buildRequest(
      { jobId: JOB_ID, status: "succeeded", resultAnalysisId: ANALYSIS_ID },
      "wrong-secret",
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(completeAnalysisJob).not.toHaveBeenCalled();
  });

  it("returns 400 when payload schema is invalid", async () => {
    const req = buildRequest({ jobId: "not-a-uuid", status: "succeeded" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(completeAnalysisJob).not.toHaveBeenCalled();
  });

  it("returns 400 when status=succeeded but resultAnalysisId is missing", async () => {
    const req = buildRequest({ jobId: JOB_ID, status: "succeeded" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(completeAnalysisJob).not.toHaveBeenCalled();
  });

  it("returns 400 when status=failed but errorCode is missing", async () => {
    const req = buildRequest({ jobId: JOB_ID, status: "failed" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(completeAnalysisJob).not.toHaveBeenCalled();
  });

  it("returns 404 when the job does not exist", async () => {
    completeAnalysisJob.mockResolvedValue({ kind: "not_found" });
    const req = buildRequest({
      jobId: JOB_ID,
      status: "succeeded",
      resultAnalysisId: ANALYSIS_ID,
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 200 with duplicate=true when the job is already terminal", async () => {
    completeAnalysisJob.mockResolvedValue({
      kind: "already_terminal",
      job: {
        id: JOB_ID,
        status: "succeeded",
        finishedAt: "2026-05-21T00:00:00Z",
        resultAnalysisId: ANALYSIS_ID,
        errorCode: null,
        errorMessage: null,
      },
    });
    const req = buildRequest({
      jobId: JOB_ID,
      status: "succeeded",
      resultAnalysisId: ANALYSIS_ID,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.duplicate).toBe(true);
    expect(body.data.status).toBe("succeeded");
  });

  it("returns 200 with the updated job on success", async () => {
    completeAnalysisJob.mockResolvedValue({
      kind: "updated",
      job: {
        id: JOB_ID,
        status: "succeeded",
        finishedAt: "2026-05-21T00:00:00Z",
        resultAnalysisId: ANALYSIS_ID,
        errorCode: null,
        errorMessage: null,
      },
    });
    const req = buildRequest({
      jobId: JOB_ID,
      status: "succeeded",
      resultAnalysisId: ANALYSIS_ID,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.duplicate).toBe(false);
    expect(body.data.job_id).toBe(JOB_ID);
    expect(body.data.result_analysis_id).toBe(ANALYSIS_ID);
    expect(completeAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: JOB_ID,
        status: "succeeded",
        resultAnalysisId: ANALYSIS_ID,
      }),
    );
  });

  it("returns 500 when completeAnalysisJob throws", async () => {
    completeAnalysisJob.mockRejectedValue(new Error("db unavailable"));
    const req = buildRequest({
      jobId: JOB_ID,
      status: "failed",
      errorCode: "ModelTimeout",
      errorMessage: "upstream timed out",
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
