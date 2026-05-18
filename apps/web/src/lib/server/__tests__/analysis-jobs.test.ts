import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthorizedPlantContext = vi.fn();
const createSupabaseServerClient = vi.fn();
const getDbClient = vi.fn();

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

import { enqueueAnalysisJob, getAnalysisJob } from "../analysis-jobs";

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
