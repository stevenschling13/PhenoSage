import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthorizedPlantContext = vi.fn();
const createSupabaseServerClient = vi.fn();
const getDbClient = vi.fn();
const rateLimit = vi.fn();

vi.mock("../plant-access", () => ({
  getAuthorizedPlantContext: (...args: unknown[]) =>
    getAuthorizedPlantContext(...args),
}));

vi.mock("../auth", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
}));

vi.mock("../db", () => ({
  getDbClient: (...args: unknown[]) => getDbClient(...args),
}));

vi.mock("../rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}));

import {
  ANALYSIS_ENQUEUE_LIMIT_PER_HOUR,
  ANALYSIS_ENQUEUE_WINDOW_MS,
  claimQueuedAnalysisJob,
  completeAnalysisJob,
  enqueueAnalysisJob,
  enqueueAnalysisJobByStoragePath,
  getAnalysisJob,
  isTerminalAnalysisJobStatus,
} from "../analysis-jobs";

const JOB_ROW = {
  id: "job-1",
  plant_id: "plant-1",
  image_id: "image-1",
  grow_id: "grow-1",
  requested_by: "user-1",
  status: "queued" as const,
  attempt_count: 0,
  max_attempts: 3,
  queued_at: "2026-05-18T00:00:00Z",
  started_at: null,
  finished_at: null,
  error_code: null,
  error_message: null,
  result_analysis_id: null,
};

const CONTEXT_OK = {
  userId: "user-1",
  plantId: "plant-1",
  plantName: "Plant 01",
  strain: null,
  notes: null,
  growId: "grow-1",
  growStage: "veg",
  medium: "coco",
  lightType: "led",
  startDate: "2026-04-01",
};

function makePlantImageQuery(result: {
  data: { id: string } | null;
  error: { message: string } | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq2 = vi.fn(() => ({ maybeSingle }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  return { select, eq1, eq2, maybeSingle };
}

function makeDb(opts: {
  image: { data: { id: string } | null; error: { message: string } | null };
  rpcResult?: { data: unknown; error: { message: string } | null };
}) {
  const imageQuery = makePlantImageQuery(opts.image);
  const from = vi.fn(() => ({ select: imageQuery.select }));
  const rpc = vi
    .fn()
    .mockResolvedValue(opts.rpcResult ?? { data: JOB_ROW, error: null });
  return { from, rpc, imageQuery };
}

beforeEach(() => {
  getAuthorizedPlantContext.mockReset();
  createSupabaseServerClient.mockReset();
  getDbClient.mockReset();
  rateLimit.mockReset();
  // Default: the rate-limiter allows the call. Tests opt into the
  // exceeded branch by overriding this in-test.
  rateLimit.mockResolvedValue({
    ok: true,
    remaining: ANALYSIS_ENQUEUE_LIMIT_PER_HOUR - 1,
    resetAt: Date.now() + ANALYSIS_ENQUEUE_WINDOW_MS,
  });
});

describe("enqueueAnalysisJob", () => {
  it("returns null when the caller has no plant access", async () => {
    getAuthorizedPlantContext.mockResolvedValue(null);
    const result = await enqueueAnalysisJob({
      plantId: "plant-1",
      imageId: "image-1",
    });
    expect(result).toBeNull();
    expect(getDbClient).not.toHaveBeenCalled();
  });

  it("returns null when the referenced image does not belong to the plant", async () => {
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    const db = makeDb({ image: { data: null, error: null } });
    getDbClient.mockReturnValue(db);

    const result = await enqueueAnalysisJob({
      plantId: "plant-1",
      imageId: "image-missing",
    });
    expect(result).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("throws when the image lookup errors", async () => {
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    const db = makeDb({
      image: { data: null, error: { message: "db boom" } },
    });
    getDbClient.mockReturnValue(db);
    await expect(
      enqueueAnalysisJob({ plantId: "plant-1", imageId: "image-1" }),
    ).rejects.toThrow(/Failed to validate analysis image: db boom/);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("throws when the RPC call errors", async () => {
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    const db = makeDb({
      image: { data: { id: "image-1" }, error: null },
      rpcResult: { data: null, error: { message: "rpc failure" } },
    });
    getDbClient.mockReturnValue(db);
    await expect(
      enqueueAnalysisJob({ plantId: "plant-1", imageId: "image-1" }),
    ).rejects.toThrow(/Failed to enqueue analysis job: rpc failure/);
  });

  it("maps the RPC row into the camelCase AnalysisJob shape and forwards idempotency key + max_attempts=3", async () => {
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    const db = makeDb({
      image: { data: { id: "image-1" }, error: null },
    });
    getDbClient.mockReturnValue(db);

    const job = await enqueueAnalysisJob({
      plantId: "plant-1",
      imageId: "image-1",
      idempotencyKey: "idem-abc",
    });

    expect(job).toEqual({
      id: "job-1",
      plantId: "plant-1",
      imageId: "image-1",
      growId: "grow-1",
      requestedBy: "user-1",
      status: "queued",
      attemptCount: 0,
      maxAttempts: 3,
      queuedAt: "2026-05-18T00:00:00Z",
      startedAt: null,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      resultAnalysisId: null,
    });

    expect(db.rpc).toHaveBeenCalledWith("enqueue_analysis_job", {
      p_plant_id: "plant-1",
      p_image_id: "image-1",
      p_grow_id: "grow-1",
      p_requested_by: "user-1",
      p_idempotency_key: "idem-abc",
      p_max_attempts: 3,
    });
  });

  it("passes p_idempotency_key as null when none is supplied", async () => {
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    const db = makeDb({
      image: { data: { id: "image-1" }, error: null },
    });
    getDbClient.mockReturnValue(db);

    await enqueueAnalysisJob({ plantId: "plant-1", imageId: "image-1" });
    expect(db.rpc).toHaveBeenCalledWith(
      "enqueue_analysis_job",
      expect.objectContaining({ p_idempotency_key: null }),
    );
  });

  it("scopes the image query to the authorized plantId, not the caller-supplied one", async () => {
    // Defends against a confused-deputy bug where the caller passes a
    // plant id they have access to but an image id from a different plant.
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    const db = makeDb({
      image: { data: { id: "image-1" }, error: null },
    });
    getDbClient.mockReturnValue(db);

    await enqueueAnalysisJob({ plantId: "plant-1", imageId: "image-1" });
    expect(db.from).toHaveBeenCalledWith("plant_images");
    expect(db.imageQuery.eq1).toHaveBeenCalledWith("id", "image-1");
    expect(db.imageQuery.eq2).toHaveBeenCalledWith(
      "plant_id",
      CONTEXT_OK.plantId,
    );
  });
});

describe("getAnalysisJob", () => {
  function makeJobLookupClient(result: {
    data: typeof JOB_ROW | null;
    error: { message: string } | null;
  }) {
    const maybeSingle = vi.fn().mockResolvedValue(result);
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return { from, select, eq, maybeSingle };
  }

  it("returns null when no row is found", async () => {
    const client = makeJobLookupClient({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);
    await expect(getAnalysisJob("job-x")).resolves.toBeNull();
  });

  it("throws when the lookup errors", async () => {
    const client = makeJobLookupClient({
      data: null,
      error: { message: "rls denied" },
    });
    createSupabaseServerClient.mockResolvedValue(client);
    await expect(getAnalysisJob("job-x")).rejects.toThrow(
      /Failed to load analysis job: rls denied/,
    );
  });

  it("maps the row into the AnalysisJob shape and queries analysis_jobs by id", async () => {
    const client = makeJobLookupClient({ data: JOB_ROW, error: null });
    createSupabaseServerClient.mockResolvedValue(client);
    const job = await getAnalysisJob("job-1");
    expect(job).toMatchObject({
      id: "job-1",
      plantId: "plant-1",
      imageId: "image-1",
      growId: "grow-1",
      requestedBy: "user-1",
      status: "queued",
      attemptCount: 0,
      maxAttempts: 3,
      queuedAt: "2026-05-18T00:00:00Z",
      resultAnalysisId: null,
    });
    expect(client.from).toHaveBeenCalledWith("analysis_jobs");
    expect(client.eq).toHaveBeenCalledWith("id", "job-1");
  });
});

describe("completeAnalysisJob", () => {
  type DbRow = {
    id: string;
    plant_id: string;
    image_id: string;
    grow_id: string;
    requested_by: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    attempt_count: number;
    max_attempts: number;
    queued_at: string;
    started_at: string | null;
    finished_at: string | null;
    error_code: string | null;
    error_message: string | null;
    result_analysis_id: string | null;
  };
  const BASE_ROW: DbRow = { ...JOB_ROW };

  function makeCompleteClient(opts: {
    loadResult: { data: DbRow | null; error: { message: string } | null };
    updateResult?: { data: DbRow | null; error: { message: string } | null };
  }) {
    const loadMaybeSingle = vi.fn().mockResolvedValue(opts.loadResult);
    const loadEq = vi.fn(() => ({ maybeSingle: loadMaybeSingle }));
    const loadSelect = vi.fn(() => ({ eq: loadEq }));

    const updateMaybeSingle = vi
      .fn()
      .mockResolvedValue(opts.updateResult ?? { data: null, error: null });
    const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle }));
    const updateEq = vi.fn(() => ({ select: updateSelect }));
    const update = vi.fn(() => ({ eq: updateEq }));

    const from = vi.fn(() => ({ select: loadSelect, update }));
    return { from, update, updateEq, loadEq };
  }

  it("returns not_found when no job row exists", async () => {
    const db = makeCompleteClient({ loadResult: { data: null, error: null } });
    getDbClient.mockReturnValue(db);
    const result = await completeAnalysisJob({
      jobId: "job-x",
      status: "succeeded",
      resultAnalysisId: "analysis-1",
    });
    expect(result).toEqual({ kind: "not_found" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("returns already_terminal without updating when the job is already terminal", async () => {
    const terminalRow: DbRow = { ...BASE_ROW, status: "succeeded" };
    const db = makeCompleteClient({
      loadResult: { data: terminalRow, error: null },
    });
    getDbClient.mockReturnValue(db);
    const result = await completeAnalysisJob({
      jobId: "job-1",
      status: "succeeded",
      resultAnalysisId: "analysis-1",
    });
    expect(result.kind).toBe("already_terminal");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("writes finished_at + result_analysis_id on success", async () => {
    const updatedRow: DbRow = {
      ...BASE_ROW,
      status: "succeeded",
      finished_at: "2026-05-21T12:00:00Z",
      result_analysis_id: "analysis-1",
    };
    const db = makeCompleteClient({
      loadResult: { data: BASE_ROW, error: null },
      updateResult: { data: updatedRow, error: null },
    });
    getDbClient.mockReturnValue(db);
    const result = await completeAnalysisJob({
      jobId: "job-1",
      status: "succeeded",
      resultAnalysisId: "analysis-1",
      finishedAt: "2026-05-21T12:00:00Z",
    });
    expect(result).toEqual({
      kind: "updated",
      job: expect.objectContaining({
        status: "succeeded",
        resultAnalysisId: "analysis-1",
        finishedAt: "2026-05-21T12:00:00Z",
      }),
    });
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        finished_at: "2026-05-21T12:00:00Z",
        result_analysis_id: "analysis-1",
        error_code: null,
        error_message: null,
      }),
    );
    expect(db.updateEq).toHaveBeenCalledWith("id", "job-1");
  });

  it("writes error_code + error_message on failure and clears result_analysis_id", async () => {
    const updatedRow: DbRow = {
      ...BASE_ROW,
      status: "failed",
      finished_at: "2026-05-21T12:00:00Z",
      error_code: "ModelTimeout",
      error_message: "upstream timed out",
    };
    const db = makeCompleteClient({
      loadResult: { data: BASE_ROW, error: null },
      updateResult: { data: updatedRow, error: null },
    });
    getDbClient.mockReturnValue(db);
    await completeAnalysisJob({
      jobId: "job-1",
      status: "failed",
      errorCode: "ModelTimeout",
      errorMessage: "upstream timed out",
    });
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_code: "ModelTimeout",
        error_message: "upstream timed out",
        result_analysis_id: null,
      }),
    );
  });
});

describe("enqueueAnalysisJobByStoragePath", () => {
  type ImageRow = {
    id: string;
    plant_id: string;
    grow_id: string;
    user_id: string;
  };
  type JobRowResult = {
    data: typeof JOB_ROW | null;
    error: { message: string } | null;
  };

  function makeClient(opts: {
    lookup: { data: ImageRow | null; error: { message: string } | null };
    existingJob?: JobRowResult;
    rpcResult?: { data: unknown; error: { message: string } | null };
  }) {
    // plant_images lookup: .from("plant_images").select(...).eq(...).maybeSingle()
    const imageMaybeSingle = vi.fn().mockResolvedValue(opts.lookup);
    const imageEq = vi.fn(() => ({ maybeSingle: imageMaybeSingle }));
    const imageSelect = vi.fn(() => ({ eq: imageEq }));

    // analysis_jobs dedup lookup: .from("analysis_jobs").select(...).eq(...).eq(...).maybeSingle()
    const dedupMaybeSingle = vi
      .fn()
      .mockResolvedValue(opts.existingJob ?? { data: null, error: null });
    const dedupEq2 = vi.fn(() => ({ maybeSingle: dedupMaybeSingle }));
    const dedupEq1 = vi.fn(() => ({ eq: dedupEq2 }));
    const dedupSelect = vi.fn(() => ({ eq: dedupEq1 }));

    const from = vi.fn((table: string) => {
      if (table === "plant_images") return { select: imageSelect };
      if (table === "analysis_jobs") return { select: dedupSelect };
      return { select: vi.fn() };
    });
    const rpc = vi
      .fn()
      .mockResolvedValue(opts.rpcResult ?? { data: JOB_ROW, error: null });
    return { from, rpc, eq: imageEq, select: imageSelect, dedupEq1, dedupEq2 };
  }

  it("returns image_not_found when no plant_images row matches", async () => {
    const db = makeClient({ lookup: { data: null, error: null } });
    getDbClient.mockReturnValue(db);
    const result = await enqueueAnalysisJobByStoragePath({
      storagePath: "plant-1/foo.jpg",
    });
    expect(result).toEqual({
      kind: "image_not_found",
      storagePath: "plant-1/foo.jpg",
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("throws when the image lookup errors", async () => {
    const db = makeClient({
      lookup: { data: null, error: { message: "lookup boom" } },
    });
    getDbClient.mockReturnValue(db);
    await expect(
      enqueueAnalysisJobByStoragePath({ storagePath: "plant-1/foo.jpg" }),
    ).rejects.toThrow(/Failed to look up plant image: lookup boom/);
  });

  it("throws when the RPC errors", async () => {
    const db = makeClient({
      lookup: {
        data: {
          id: "image-1",
          plant_id: "plant-1",
          grow_id: "grow-1",
          user_id: "user-1",
        },
        error: null,
      },
      rpcResult: { data: null, error: { message: "rpc boom" } },
    });
    getDbClient.mockReturnValue(db);
    await expect(
      enqueueAnalysisJobByStoragePath({ storagePath: "plant-1/foo.jpg" }),
    ).rejects.toThrow(/Failed to enqueue analysis job: rpc boom/);
  });

  it("enqueues using the image row's plant/grow/user with a storage-webhook idempotency key", async () => {
    const db = makeClient({
      lookup: {
        data: {
          id: "image-42",
          plant_id: "plant-1",
          grow_id: "grow-1",
          user_id: "user-1",
        },
        error: null,
      },
    });
    getDbClient.mockReturnValue(db);
    const result = await enqueueAnalysisJobByStoragePath({
      storagePath: "plant-1/abc.jpg",
    });
    expect(result.kind).toBe("enqueued");
    expect(db.rpc).toHaveBeenCalledWith("enqueue_analysis_job", {
      p_plant_id: "plant-1",
      p_image_id: "image-42",
      p_grow_id: "grow-1",
      p_requested_by: "user-1",
      p_idempotency_key: "storage-webhook:image-42",
      p_max_attempts: 3,
    });
    expect(db.eq).toHaveBeenCalledWith("storage_path", "plant-1/abc.jpg");
  });

  it("rate-limits per user_id with key analysis-enqueue:<userId>", async () => {
    const db = makeClient({
      lookup: {
        data: {
          id: "image-42",
          plant_id: "plant-1",
          grow_id: "grow-1",
          user_id: "user-1",
        },
        error: null,
      },
    });
    getDbClient.mockReturnValue(db);
    await enqueueAnalysisJobByStoragePath({ storagePath: "plant-1/abc.jpg" });
    expect(rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "analysis-enqueue:user-1",
        limit: ANALYSIS_ENQUEUE_LIMIT_PER_HOUR,
        windowMs: ANALYSIS_ENQUEUE_WINDOW_MS,
      }),
    );
  });

  it("returns rate_limited without enqueueing when the cap is hit", async () => {
    const resetAt = Date.now() + 30 * 60 * 1000;
    rateLimit.mockResolvedValue({ ok: false, remaining: 0, resetAt });
    const db = makeClient({
      lookup: {
        data: {
          id: "image-42",
          plant_id: "plant-1",
          grow_id: "grow-1",
          user_id: "user-1",
        },
        error: null,
      },
    });
    getDbClient.mockReturnValue(db);
    const result = await enqueueAnalysisJobByStoragePath({
      storagePath: "plant-1/abc.jpg",
    });
    expect(result).toEqual({
      kind: "rate_limited",
      userId: "user-1",
      resetAt,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("short-circuits to existing job WITHOUT consuming a token on duplicate delivery", async () => {
    const db = makeClient({
      lookup: {
        data: {
          id: "image-42",
          plant_id: "plant-1",
          grow_id: "grow-1",
          user_id: "user-1",
        },
        error: null,
      },
      existingJob: { data: JOB_ROW, error: null },
    });
    getDbClient.mockReturnValue(db);
    const result = await enqueueAnalysisJobByStoragePath({
      storagePath: "plant-1/abc.jpg",
    });
    expect(result.kind).toBe("enqueued");
    expect(rateLimit).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.dedupEq1).toHaveBeenCalledWith("image_id", "image-42");
    expect(db.dedupEq2).toHaveBeenCalledWith(
      "idempotency_key",
      "storage-webhook:image-42",
    );
  });

  it("does NOT consume a token when image lookup fails (no row to rate-limit)", async () => {
    const db = makeClient({ lookup: { data: null, error: null } });
    getDbClient.mockReturnValue(db);
    await enqueueAnalysisJobByStoragePath({ storagePath: "plant-1/foo.jpg" });
    expect(rateLimit).not.toHaveBeenCalled();
  });
});

describe("isTerminalAnalysisJobStatus", () => {
  it("classifies terminal vs non-terminal statuses", () => {
    expect(isTerminalAnalysisJobStatus("succeeded")).toBe(true);
    expect(isTerminalAnalysisJobStatus("failed")).toBe(true);
    expect(isTerminalAnalysisJobStatus("cancelled")).toBe(true);
    expect(isTerminalAnalysisJobStatus("queued")).toBe(false);
    expect(isTerminalAnalysisJobStatus("running")).toBe(false);
    expect(isTerminalAnalysisJobStatus("retrying")).toBe(false);
  });
});

describe("claimQueuedAnalysisJob", () => {
  function makeClaimClient(result: {
    data:
      | (Omit<typeof JOB_ROW, "status" | "started_at"> & {
          status: string;
          started_at: string | null;
        })
      | null;
    error: { message: string } | null;
  }) {
    const maybeSingle = vi.fn().mockResolvedValue(result);
    const select = vi.fn(() => ({ maybeSingle }));
    const eqStatus = vi.fn(() => ({ select }));
    const eqId = vi.fn(() => ({ eq: eqStatus }));
    const update = vi.fn(() => ({ eq: eqId }));
    const from = vi.fn(() => ({ update }));
    return { from, update, eqId, eqStatus };
  }

  it("claims a queued job with a compare-and-set on status", async () => {
    const claimedRow = {
      ...JOB_ROW,
      status: "running" as const,
      attempt_count: 1,
      started_at: "2026-06-10T00:00:01Z",
    };
    const db = makeClaimClient({ data: claimedRow, error: null });
    getDbClient.mockReturnValue(db);

    const job = await claimQueuedAnalysisJob({ id: "job-1", attemptCount: 0 });

    expect(job?.status).toBe("running");
    expect(job?.attemptCount).toBe(1);
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "running", attempt_count: 1 }),
    );
    expect(db.eqId).toHaveBeenCalledWith("id", "job-1");
    expect(db.eqStatus).toHaveBeenCalledWith("status", "queued");
  });

  it("returns null when the job was already claimed", async () => {
    const db = makeClaimClient({ data: null, error: null });
    getDbClient.mockReturnValue(db);
    const job = await claimQueuedAnalysisJob({ id: "job-1", attemptCount: 0 });
    expect(job).toBeNull();
  });

  it("throws on a database error", async () => {
    const db = makeClaimClient({ data: null, error: { message: "boom" } });
    getDbClient.mockReturnValue(db);
    await expect(
      claimQueuedAnalysisJob({ id: "job-1", attemptCount: 0 }),
    ).rejects.toThrow("Failed to claim analysis job: boom");
  });
});
