import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const claimQueuedAnalysisJob = vi.fn();
const completeAnalysisJob = vi.fn();
const getServiceRolePlantContext = vi.fn();
const runAndPersistPlantAnalysisForContext = vi.fn();
const logServerEvent = vi.fn();

vi.mock("../analysis-jobs", () => ({
  claimQueuedAnalysisJob: (...args: unknown[]) =>
    claimQueuedAnalysisJob(...args),
  completeAnalysisJob: (...args: unknown[]) => completeAnalysisJob(...args),
}));

vi.mock("../plant-access", () => ({
  getServiceRolePlantContext: (...args: unknown[]) =>
    getServiceRolePlantContext(...args),
}));

vi.mock("../plants", () => ({
  runAndPersistPlantAnalysisForContext: (...args: unknown[]) =>
    runAndPersistPlantAnalysisForContext(...args),
}));

vi.mock("../request-id", () => ({
  logServerEvent: (...args: unknown[]) => logServerEvent(...args),
}));

import { executeAnalysisJob } from "../analysis-job-runner";

const QUEUED_JOB = {
  id: "job-1",
  plantId: "plant-1",
  imageId: "image-1",
  growId: "grow-1",
  requestedBy: "user-1",
  status: "queued" as const,
  attemptCount: 0,
  maxAttempts: 3,
  queuedAt: "2026-06-10T00:00:00Z",
  startedAt: null,
  finishedAt: null,
  errorCode: null,
  errorMessage: null,
  resultAnalysisId: null,
};

const CLAIMED_JOB = {
  ...QUEUED_JOB,
  status: "running" as const,
  attemptCount: 1,
  startedAt: "2026-06-10T00:00:01Z",
};

const CONTEXT = {
  userId: "user-1",
  plantId: "plant-1",
  plantName: "Plant 01",
  strain: null,
  notes: null,
  growId: "grow-1",
  growStage: "veg",
  medium: "coco",
  lightType: null,
  startDate: null,
};

describe("executeAnalysisJob", () => {
  beforeEach(() => {
    for (const mock of [
      claimQueuedAnalysisJob,
      completeAnalysisJob,
      getServiceRolePlantContext,
      runAndPersistPlantAnalysisForContext,
      logServerEvent,
    ]) {
      (mock as Mock).mockReset();
    }
    completeAnalysisJob.mockResolvedValue({ kind: "updated", job: {} });
  });

  it("skips jobs that are not queued (idempotent replays)", async () => {
    await executeAnalysisJob(
      { ...QUEUED_JOB, status: "succeeded" as const },
      "req-1",
    );
    expect(claimQueuedAnalysisJob).not.toHaveBeenCalled();
    expect(runAndPersistPlantAnalysisForContext).not.toHaveBeenCalled();
    expect(completeAnalysisJob).not.toHaveBeenCalled();
  });

  it("skips when another invocation already claimed the job", async () => {
    claimQueuedAnalysisJob.mockResolvedValue(null);
    await executeAnalysisJob(QUEUED_JOB, "req-1");
    expect(runAndPersistPlantAnalysisForContext).not.toHaveBeenCalled();
    expect(completeAnalysisJob).not.toHaveBeenCalled();
  });

  it("logs and bails when the claim itself fails", async () => {
    claimQueuedAnalysisJob.mockRejectedValue(new Error("db down"));
    await executeAnalysisJob(QUEUED_JOB, "req-1");
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "analysis job runner: claim failed",
      expect.objectContaining({ jobId: "job-1" }),
    );
    expect(completeAnalysisJob).not.toHaveBeenCalled();
  });

  it("fails the job when the plant no longer exists", async () => {
    claimQueuedAnalysisJob.mockResolvedValue(CLAIMED_JOB);
    getServiceRolePlantContext.mockResolvedValue(null);
    await executeAnalysisJob(QUEUED_JOB, "req-1");
    expect(completeAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "failed",
        errorCode: "plant_not_found",
      }),
    );
    expect(runAndPersistPlantAnalysisForContext).not.toHaveBeenCalled();
  });

  it("fails the job when the image is gone", async () => {
    claimQueuedAnalysisJob.mockResolvedValue(CLAIMED_JOB);
    getServiceRolePlantContext.mockResolvedValue(CONTEXT);
    runAndPersistPlantAnalysisForContext.mockResolvedValue({
      context: CONTEXT,
      analysis: null,
    });
    await executeAnalysisJob(QUEUED_JOB, "req-1");
    expect(completeAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "failed",
        errorCode: "image_not_found",
      }),
    );
  });

  it("records success with the persisted analysis id", async () => {
    claimQueuedAnalysisJob.mockResolvedValue(CLAIMED_JOB);
    getServiceRolePlantContext.mockResolvedValue(CONTEXT);
    runAndPersistPlantAnalysisForContext.mockResolvedValue({
      context: CONTEXT,
      analysis: { isFallback: false },
      analysisId: "analysis-9",
      imageId: "image-1",
    });
    await executeAnalysisJob(QUEUED_JOB, "req-1");
    expect(runAndPersistPlantAnalysisForContext).toHaveBeenCalledWith(CONTEXT, {
      imageId: "image-1",
      requestId: "req-1",
    });
    expect(completeAnalysisJob).toHaveBeenCalledWith({
      jobId: "job-1",
      status: "succeeded",
      resultAnalysisId: "analysis-9",
    });
  });

  it("fails the job with sanitized copy when analysis throws", async () => {
    claimQueuedAnalysisJob.mockResolvedValue(CLAIMED_JOB);
    getServiceRolePlantContext.mockResolvedValue(CONTEXT);
    runAndPersistPlantAnalysisForContext.mockRejectedValue(
      new Error("fetch failed: https://internal-railway-url"),
    );
    await executeAnalysisJob(QUEUED_JOB, "req-1");
    expect(completeAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "failed",
        errorCode: "analysis_error",
      }),
    );
    const call = completeAnalysisJob.mock.calls[0]?.[0] as {
      errorMessage: string;
    };
    expect(call.errorMessage).not.toContain("railway");
    expect(call.errorMessage).not.toContain("fetch failed");
  });

  it("survives a failure while recording the failure", async () => {
    claimQueuedAnalysisJob.mockResolvedValue(CLAIMED_JOB);
    getServiceRolePlantContext.mockResolvedValue(CONTEXT);
    runAndPersistPlantAnalysisForContext.mockRejectedValue(new Error("boom"));
    completeAnalysisJob.mockRejectedValue(new Error("db down"));
    await expect(
      executeAnalysisJob(QUEUED_JOB, "req-1"),
    ).resolves.toBeUndefined();
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "analysis job runner: failure record failed",
      expect.objectContaining({ jobId: "job-1" }),
    );
  });
});
