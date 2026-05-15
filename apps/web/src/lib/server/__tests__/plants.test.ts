import { beforeEach, describe, expect, it, vi } from "vitest";

const analyzeImage = vi.fn();
const createSupabaseServerClient = vi.fn();
const getAuthorizedPlantContext = vi.fn();
const getDbClient = vi.fn();
const getStorageClient = vi.fn();
const logServerEvent = vi.fn();
const persistFindingEmbeddings = vi.fn();

vi.mock("../analysis-proxy", () => ({
  analyzeImage: (...args: unknown[]) => analyzeImage(...args),
}));
vi.mock("../auth", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
}));
vi.mock("../db", () => ({
  getDbClient: (...args: unknown[]) => getDbClient(...args),
}));
vi.mock("../embeddings", () => ({
  persistFindingEmbeddings: (...args: unknown[]) =>
    persistFindingEmbeddings(...args),
}));
vi.mock("../plant-access", () => ({
  getAuthorizedPlantContext: (...args: unknown[]) =>
    getAuthorizedPlantContext(...args),
}));
vi.mock("../request-id", () => ({
  logServerEvent: (...args: unknown[]) => logServerEvent(...args),
}));
vi.mock("../storage", () => ({
  getStorageClient: (...args: unknown[]) => getStorageClient(...args),
}));

import {
  getLatestPlantAnalysis,
  getPlantTimeline,
  persistPlantImageUpload,
  preparePlantImageUpload,
  runAndPersistPlantAnalysis,
} from "../plants";

const PLANT_CONTEXT = {
  growId: "grow-1",
  growStage: "flower",
  lightType: "LED",
  medium: "coco",
  notes: "Watch lower leaves",
  plantId: "plant-1",
  plantName: "Blue Dream #1",
  startDate: "2026-05-01",
  strain: "Blue Dream",
  userId: "user-1",
};

function makeSelectOrderResult(data: unknown[] | null, message?: string) {
  const order = vi.fn().mockResolvedValue({
    data,
    error: message ? { message } : null,
  });
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  return { eq, order, select };
}

function makeImagesLimitResult(data: unknown[] | null, message?: string) {
  const limit = vi.fn().mockResolvedValue({
    data,
    error: message ? { message } : null,
  });
  const order = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  return { eq, limit, order, select };
}

function makeAnalysisPersistenceDb(params?: {
  imageRows?: unknown[] | null;
  imageError?: string;
  upsertError?: string;
  deleteError?: string;
  findingError?: string;
}) {
  const images = makeImagesLimitResult(
    params?.imageRows ?? [
      {
        created_at: "2026-05-11T00:00:00Z",
        grow_id: "grow-1",
        id: "image-current",
        notes: null,
        plant_id: "plant-1",
        source: "upload",
        storage_path: "plant-1/current.jpg",
        taken_at: null,
        user_id: "user-1",
      },
    ],
    params?.imageError,
  );
  const single = vi.fn().mockResolvedValue({
    data: params?.upsertError ? null : { id: "analysis-1" },
    error: params?.upsertError ? { message: params.upsertError } : null,
  });
  const upsertSelect = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select: upsertSelect }));
  const deleteEq = vi.fn().mockResolvedValue({
    error: params?.deleteError ? { message: params.deleteError } : null,
  });
  const deleteFn = vi.fn(() => ({ eq: deleteEq }));
  // The findings insert is now followed by .select() so the analysis
  // pipeline can hand finding IDs to the notifications fan-out. The
  // mock mirrors the supabase-js builder shape: insert(...).select()
  // returns { data, error }.
  const insertSelect = vi.fn().mockResolvedValue({
    data: params?.findingError
      ? null
      : [
          {
            id: "finding-1",
            severity: "info",
            title: "stub",
            description: "stub",
            recommendation: null,
            category: "general",
          },
        ],
    error: params?.findingError ? { message: params.findingError } : null,
  });
  const insert = vi.fn(() => ({ select: insertSelect }));
  const from = vi.fn((table: string) => {
    if (table === "plant_images") {
      return { select: images.select };
    }
    if (table === "plant_analyses") {
      return { upsert };
    }
    return { delete: deleteFn, insert };
  });

  return { deleteEq, deleteFn, from, images, insert, upsert };
}

describe("plants server helpers", () => {
  beforeEach(() => {
    analyzeImage.mockReset();
    createSupabaseServerClient.mockReset();
    getAuthorizedPlantContext.mockReset();
    getDbClient.mockReset();
    getStorageClient.mockReset();
    logServerEvent.mockReset();
    persistFindingEmbeddings.mockReset();
    persistFindingEmbeddings.mockResolvedValue({
      failed: 0,
      generated: 1,
      ok: true,
      skipped: 0,
      updated: 1,
    });
    getAuthorizedPlantContext.mockResolvedValue(PLANT_CONTEXT);
  });

  it("returns null for upload preparation when the plant is not authorized", async () => {
    getAuthorizedPlantContext.mockResolvedValue(null);

    await expect(
      preparePlantImageUpload({
        contentType: "image/jpeg",
        fileName: "plant.jpg",
        plantId: "plant-1",
        requestId: "req-1",
      }),
    ).resolves.toBeNull();
    expect(getStorageClient).not.toHaveBeenCalled();
  });

  it("prepares signed uploads with sanitized storage paths and audit logging", async () => {
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("image-uuid");
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { token: "signed-token" },
      error: null,
    });
    const from = vi.fn(() => ({ createSignedUploadUrl }));
    getStorageClient.mockReturnValue({ from });

    await expect(
      preparePlantImageUpload({
        contentType: "image/jpeg",
        fileName: "My plant photo!.jpg",
        plantId: "plant-1",
        requestId: "req-1",
      }),
    ).resolves.toEqual({
      imageId: "image-uuid",
      plantId: "plant-1",
      storagePath: "plant-1/1800000000000-image-uuid-My-plant-photo-.jpg",
      token: "signed-token",
    });
    expect(from).toHaveBeenCalledWith("plant-images");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      "plant-1/1800000000000-image-uuid-My-plant-photo-.jpg",
    );
    expect(logServerEvent).toHaveBeenCalledWith(
      "info",
      "plant image upload prepared",
      expect.objectContaining({
        imageId: "image-uuid",
        plantId: "plant-1",
        requestId: "req-1",
      }),
    );

    randomUUID.mockRestore();
    now.mockRestore();
  });

  it("throws when signed upload URL creation fails", async () => {
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "bucket unavailable" },
    });
    const from = vi.fn(() => ({ createSignedUploadUrl }));
    getStorageClient.mockReturnValue({ from });

    await expect(
      preparePlantImageUpload({
        contentType: "image/jpeg",
        fileName: "plant.jpg",
        plantId: "plant-1",
        requestId: "req-1",
      }),
    ).rejects.toThrow("Failed to create signed upload URL: bucket unavailable");
  });

  it("returns null for finalized image persistence when the plant is not authorized", async () => {
    getAuthorizedPlantContext.mockResolvedValue(null);

    await expect(
      persistPlantImageUpload({
        imageId: "image-1",
        plantId: "plant-1",
        storagePath: "plant-1/image.jpg",
      }),
    ).resolves.toBeNull();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("rejects finalized uploads whose storage path belongs to another plant", async () => {
    await expect(
      persistPlantImageUpload({
        imageId: "image-1",
        plantId: "plant-1",
        storagePath: "other-plant/image.jpg",
      }),
    ).rejects.toThrow("Upload path does not match the requested plant.");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("persists finalized image metadata with the authorized grow and user", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));
    createSupabaseServerClient.mockResolvedValue({ from });

    await expect(
      persistPlantImageUpload({
        imageId: "image-1",
        notes: "first upload",
        plantId: "plant-1",
        source: "camera",
        storagePath: "plant-1/image.jpg",
        takenAt: "2026-05-01T00:00:00Z",
      }),
    ).resolves.toEqual({
      imageId: "image-1",
      plantId: "plant-1",
      storagePath: "plant-1/image.jpg",
    });
    expect(insert).toHaveBeenCalledWith({
      grow_id: "grow-1",
      id: "image-1",
      notes: "first upload",
      plant_id: "plant-1",
      source: "camera",
      storage_path: "plant-1/image.jpg",
      taken_at: "2026-05-01T00:00:00Z",
      user_id: "user-1",
    });
  });

  it("throws when finalized image metadata persistence fails", async () => {
    const insert = vi.fn().mockResolvedValue({
      error: { message: "insert rejected" },
    });
    const from = vi.fn(() => ({ insert }));
    createSupabaseServerClient.mockResolvedValue({ from });

    await expect(
      persistPlantImageUpload({
        imageId: "image-1",
        plantId: "plant-1",
        storagePath: "plant-1/image.jpg",
      }),
    ).rejects.toThrow(
      "Failed to persist plant image metadata: insert rejected",
    );
  });

  it("returns null for latest analysis when the plant is not authorized", async () => {
    getAuthorizedPlantContext.mockResolvedValue(null);

    await expect(getLatestPlantAnalysis("plant-1")).resolves.toBeNull();
    expect(getDbClient).not.toHaveBeenCalled();
  });

  it("returns null for latest analysis when no persisted row exists", async () => {
    const analysisMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    const analysisLimit = vi.fn(() => ({ maybeSingle: analysisMaybeSingle }));
    const analysisOrder = vi.fn(() => ({ limit: analysisLimit }));
    const analysisEq = vi.fn(() => ({ order: analysisOrder }));
    const analysisSelect = vi.fn(() => ({ eq: analysisEq }));
    getDbClient.mockReturnValue({
      from: vi.fn(() => ({ select: analysisSelect })),
    });

    await expect(getLatestPlantAnalysis("plant-1")).resolves.toBeNull();
  });

  it("returns null and logs when the latest analysis query fails", async () => {
    const analysisMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "analysis table unavailable" },
    });
    const analysisLimit = vi.fn(() => ({ maybeSingle: analysisMaybeSingle }));
    const analysisOrder = vi.fn(() => ({ limit: analysisLimit }));
    const analysisEq = vi.fn(() => ({ order: analysisOrder }));
    const analysisSelect = vi.fn(() => ({ eq: analysisEq }));
    getDbClient.mockReturnValue({
      from: vi.fn(() => ({ select: analysisSelect })),
    });

    await expect(getLatestPlantAnalysis("plant-1")).resolves.toBeNull();
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "latest plant analysis query failed",
      expect.objectContaining({
        error: "analysis table unavailable",
        plantId: "plant-1",
      }),
    );
  });

  it("keeps the latest analysis when findings fail to load", async () => {
    const analysisMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        analysis_mode: "model",
        analyzed_at: "2026-05-02T00:00:00Z",
        compared_to_image_id: null,
        comparison_summary: null,
        created_at: "2026-05-02T00:00:00Z",
        fallback_reason: null,
        grow_id: "grow-1",
        id: "analysis-1",
        image_id: "image-1",
        is_fallback: false,
        model_version: "gpt-4o-mini-vision",
        overall_health_score: 91,
        plant_id: "plant-1",
        request_id: null,
        summary: "Healthy canopy.",
      },
      error: null,
    });
    const analysisLimit = vi.fn(() => ({ maybeSingle: analysisMaybeSingle }));
    const analysisOrder = vi.fn(() => ({ limit: analysisLimit }));
    const analysisEq = vi.fn(() => ({ order: analysisOrder }));
    const analysisSelect = vi.fn(() => ({ eq: analysisEq }));
    const findings = makeSelectOrderResult(null, "findings table unavailable");
    const from = vi.fn((table: string) =>
      table === "plant_analyses"
        ? { select: analysisSelect }
        : { select: findings.select },
    );
    getDbClient.mockReturnValue({ from });

    await expect(getLatestPlantAnalysis("plant-1")).resolves.toMatchObject({
      findings: [],
      imageId: "image-1",
      overallHealthScore: 91,
      summary: "Healthy canopy.",
    });
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "latest plant analysis findings query failed",
      expect.objectContaining({
        error: "findings table unavailable",
        imageId: "image-1",
      }),
    );
  });

  it("maps the latest persisted analysis and associated findings", async () => {
    const analysisMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        analysis_mode: "fallback",
        analyzed_at: "2026-05-02T00:00:00Z",
        compared_to_image_id: "image-0",
        comparison_summary: "Improving",
        created_at: "2026-05-02T00:00:00Z",
        fallback_reason: "TimeoutError",
        grow_id: "grow-1",
        id: "analysis-1",
        image_id: "image-1",
        is_fallback: true,
        model_version: "gpt-4o-mini-vision",
        overall_health_score: 55,
        plant_id: "plant-1",
        request_id: "req-analysis",
        summary: "Inconclusive fallback result.",
      },
      error: null,
    });
    const analysisLimit = vi.fn(() => ({ maybeSingle: analysisMaybeSingle }));
    const analysisOrder = vi.fn(() => ({ limit: analysisLimit }));
    const analysisEq = vi.fn(() => ({ order: analysisOrder }));
    const analysisSelect = vi.fn(() => ({ eq: analysisEq }));
    const findings = makeSelectOrderResult([
      {
        category: "nutrient_deficiency",
        confidence_score: 0.73,
        created_at: "2026-05-02T00:01:00Z",
        description: "Interveinal chlorosis.",
        grow_id: "grow-1",
        id: "finding-1",
        image_id: "image-1",
        plant_id: "plant-1",
        recommendation: "Add Cal-Mag.",
        severity: "medium",
        title: "Magnesium deficiency",
      },
    ]);
    const from = vi.fn((table: string) =>
      table === "plant_analyses"
        ? { select: analysisSelect }
        : { select: findings.select },
    );
    getDbClient.mockReturnValue({ from });

    await expect(getLatestPlantAnalysis("plant-1")).resolves.toEqual({
      analysisMode: "fallback",
      analyzedAt: "2026-05-02T00:00:00Z",
      comparedToImageId: "image-0",
      comparisonSummary: "Improving",
      fallbackReason: "TimeoutError",
      findings: [
        {
          category: "nutrient_deficiency",
          confidenceScore: 0.73,
          description: "Interveinal chlorosis.",
          recommendation: "Add Cal-Mag.",
          severity: "medium",
          title: "Magnesium deficiency",
        },
      ],
      imageId: "image-1",
      isFallback: true,
      modelVersion: "gpt-4o-mini-vision",
      overallHealthScore: 55,
      plantId: "plant-1",
      requestId: "req-analysis",
      summary: "Inconclusive fallback result.",
    });
  });

  it("combines image and observation timeline items in user-visible order", async () => {
    const tableResults: Record<string, unknown[]> = {
      plant_analyses: [
        {
          analysis_mode: "model",
          analyzed_at: "2026-05-04T00:00:00Z",
          compared_to_image_id: null,
          comparison_summary: null,
          created_at: "2026-05-04T00:00:00Z",
          fallback_reason: null,
          grow_id: "grow-1",
          id: "analysis-1",
          image_id: "image-1",
          is_fallback: false,
          model_version: "gpt-4o-mini-vision",
          overall_health_score: 88,
          plant_id: "plant-1",
          request_id: null,
          summary: "Healthy canopy.",
        },
      ],
      plant_findings: [
        {
          category: "positive",
          confidence_score: 0.94,
          created_at: "2026-05-04T00:01:00Z",
          description: "Strong color.",
          grow_id: "grow-1",
          id: "finding-1",
          image_id: "image-1",
          plant_id: "plant-1",
          recommendation: "Keep the current environment steady.",
          severity: "info",
          title: "Good vigor",
        },
        {
          category: "general",
          confidence_score: null,
          created_at: "2026-05-04T00:02:00Z",
          description: "Plant-level note.",
          grow_id: "grow-1",
          id: "finding-2",
          image_id: null,
          plant_id: "plant-1",
          recommendation: null,
          severity: "info",
          title: "No image link",
        },
      ],
      plant_images: [
        {
          created_at: "2026-05-04T00:00:00Z",
          grow_id: "grow-1",
          id: "image-1",
          notes: "front view",
          plant_id: "plant-1",
          source: "upload",
          storage_path: "plant-1/image.jpg",
          taken_at: "2026-05-04T00:00:00Z",
          user_id: "user-1",
        },
      ],
      plant_observations: [
        {
          created_at: "2026-05-05T00:00:00Z",
          height_cm: 42,
          id: "observation-1",
          notes: "stretched overnight",
          observed_at: "2026-05-05T00:00:00Z",
        },
      ],
    };
    const from = vi.fn((table: string) => ({
      select: makeSelectOrderResult(tableResults[table] ?? []).select,
    }));
    getDbClient.mockReturnValue({ from });

    const timeline = await getPlantTimeline("plant-1");

    expect(timeline?.plantId).toBe("plant-1");
    expect(timeline?.items.map((item) => item.type)).toEqual([
      "observation",
      "image",
    ]);
    expect(timeline?.items[1]).toMatchObject({
      analysis: {
        findings: [
          {
            category: "positive",
            confidenceScore: 0.94,
            description: "Strong color.",
            recommendation: "Keep the current environment steady.",
            severity: "info",
            title: "Good vigor",
          },
        ],
        overallHealthScore: 88,
        summary: "Healthy canopy.",
      },
      findings: [
        {
          category: "positive",
          confidenceScore: 0.94,
          description: "Strong color.",
          recommendation: "Keep the current environment steady.",
          severity: "info",
          title: "Good vigor",
        },
      ],
      id: "image-1",
      notes: "front view",
      storagePath: "plant-1/image.jpg",
      type: "image",
    });
  });

  it("degrades failed timeline sources while keeping available items", async () => {
    const tableResults: Record<string, unknown[] | null> = {
      plant_analyses: [
        {
          analysis_mode: "model",
          analyzed_at: "2026-05-04T00:00:00Z",
          compared_to_image_id: null,
          comparison_summary: null,
          created_at: "2026-05-04T00:00:00Z",
          fallback_reason: null,
          grow_id: "grow-1",
          id: "analysis-1",
          image_id: "image-1",
          is_fallback: false,
          model_version: "gpt-4o-mini-vision",
          overall_health_score: 88,
          plant_id: "plant-1",
          request_id: null,
          summary: "Healthy canopy.",
        },
      ],
      plant_findings: [
        {
          category: "positive",
          confidence_score: 0.81,
          created_at: "2026-05-04T00:01:00Z",
          description: "Strong color.",
          grow_id: "grow-1",
          id: "finding-1",
          image_id: "image-1",
          plant_id: "plant-1",
          recommendation: "Keep current feeding.",
          severity: "info",
          title: "Good vigor",
        },
      ],
      plant_observations: null,
    };
    const rejectedOrder = vi
      .fn()
      .mockRejectedValue(new Error("plant images timeout"));
    const observations = makeSelectOrderResult(null, "observations denied");
    const from = vi.fn((table: string) => {
      if (table === "plant_images") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ order: rejectedOrder })),
          })),
        };
      }
      if (table === "plant_observations") {
        return { select: observations.select };
      }
      return {
        select: makeSelectOrderResult(tableResults[table] ?? []).select,
      };
    });
    getDbClient.mockReturnValue({ from });

    const timeline = await getPlantTimeline("plant-1");

    expect(timeline).toEqual({ plantId: "plant-1", items: [] });
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "plant timeline query rejected",
      expect.objectContaining({
        error: "plant images timeout",
        source: "plant_images",
      }),
    );
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "plant timeline query failed",
      expect.objectContaining({
        error: "observations denied",
        source: "plant_observations",
      }),
    );
  });

  it("returns null for timelines when the plant is not authorized", async () => {
    getAuthorizedPlantContext.mockResolvedValue(null);

    await expect(getPlantTimeline("plant-1")).resolves.toBeNull();
    expect(getDbClient).not.toHaveBeenCalled();
  });

  it("returns null for analysis persistence when the plant is not authorized", async () => {
    getAuthorizedPlantContext.mockResolvedValue(null);

    await expect(
      runAndPersistPlantAnalysis({
        plantId: "plant-1",
        requestId: "req-1",
      }),
    ).resolves.toBeNull();
    expect(getDbClient).not.toHaveBeenCalled();
  });

  it("returns an empty analysis result when the requested image is absent", async () => {
    const db = makeAnalysisPersistenceDb({
      imageRows: [
        {
          created_at: "2026-05-10T00:00:00Z",
          grow_id: "grow-1",
          id: "different-image",
          notes: null,
          plant_id: "plant-1",
          source: "upload",
          storage_path: "plant-1/different.jpg",
          taken_at: null,
          user_id: "user-1",
        },
      ],
    });
    getDbClient.mockReturnValue({ from: db.from });

    await expect(
      runAndPersistPlantAnalysis({
        imageId: "missing-image",
        plantId: "plant-1",
        requestId: "req-1",
      }),
    ).resolves.toEqual({ context: PLANT_CONTEXT, analysis: null });
    expect(analyzeImage).not.toHaveBeenCalled();
  });

  it("throws when loading candidate images for analysis fails", async () => {
    const db = makeAnalysisPersistenceDb({ imageError: "image query failed" });
    getDbClient.mockReturnValue({ from: db.from });

    await expect(
      runAndPersistPlantAnalysis({
        plantId: "plant-1",
        requestId: "req-1",
      }),
    ).rejects.toThrow(
      "Failed to load plant images for analysis: image query failed",
    );
  });

  it.each([null, "not-a-date"])(
    "omits daysSinceStart from analysis context when startDate is %s",
    async (startDate) => {
      getAuthorizedPlantContext.mockResolvedValue({
        ...PLANT_CONTEXT,
        startDate,
      });
      analyzeImage.mockResolvedValue({
        analysisMode: "model",
        analyzedAt: "2026-05-11T00:00:00Z",
        findings: [],
        imageId: "image-current",
        isFallback: false,
        modelVersion: "gpt-4o-mini-vision",
        overallHealthScore: 88,
        plantId: "plant-1",
        requestId: "analysis-req",
        summary: "Looks healthy.",
      });
      const db = makeAnalysisPersistenceDb();
      getDbClient.mockReturnValue({ from: db.from });

      await expect(
        runAndPersistPlantAnalysis({
          plantId: "plant-1",
          requestId: "req-1",
        }),
      ).resolves.toMatchObject({
        analysis: { summary: "Looks healthy." },
      });
      expect(analyzeImage).toHaveBeenCalledWith(
        expect.objectContaining({
          growContext: expect.not.objectContaining({
            daysSinceStart: expect.any(Number),
          }),
        }),
      );
      expect(db.insert).not.toHaveBeenCalled();
    },
  );

  it("runs analysis for the newest image and replaces persisted findings", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-05-11T00:00:00Z").getTime());
    analyzeImage.mockResolvedValue({
      analysisMode: "model",
      analyzedAt: "2026-05-11T00:00:00Z",
      comparedToImageId: "image-previous",
      comparisonSummary: "Less yellowing than before.",
      findings: [
        {
          category: "positive",
          confidenceScore: 0.92,
          description: "New growth is upright.",
          recommendation: "Maintain current environment.",
          severity: "info",
          title: "Improved posture",
        },
      ],
      imageId: "image-current",
      isFallback: false,
      modelVersion: "gpt-4o-mini-vision",
      overallHealthScore: 92,
      plantId: "plant-1",
      requestId: "analysis-req",
      summary: "Plant is trending better.",
    });
    const imagesLimit = vi.fn().mockResolvedValue({
      data: [
        {
          created_at: "2026-05-11T00:00:00Z",
          grow_id: "grow-1",
          id: "image-current",
          notes: null,
          plant_id: "plant-1",
          source: "upload",
          storage_path: "plant-1/current.jpg",
          taken_at: null,
          user_id: "user-1",
        },
        {
          created_at: "2026-05-10T00:00:00Z",
          grow_id: "grow-1",
          id: "image-previous",
          notes: null,
          plant_id: "plant-1",
          source: "upload",
          storage_path: "plant-1/previous.jpg",
          taken_at: null,
          user_id: "user-1",
        },
      ],
      error: null,
    });
    const upsertSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "analysis-1" }, error: null });
    const upsert = vi.fn(() => ({
      select: vi.fn(() => ({ single: upsertSingle })),
    }));
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const deleteFn = vi.fn(() => ({ eq: deleteEq }));
    const insert = vi.fn(() => ({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            id: "finding-1",
            severity: "info",
            title: "Improved posture",
            description: "New growth is upright.",
            recommendation: "Maintain current environment.",
            category: "positive",
          },
        ],
        error: null,
      }),
    }));
    const from = vi.fn((table: string) => {
      if (table === "plant_images") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({ limit: imagesLimit })),
            })),
          })),
        };
      }
      if (table === "plant_analyses") {
        return { upsert };
      }
      return { delete: deleteFn, insert };
    });
    getDbClient.mockReturnValue({ from });

    const result = await runAndPersistPlantAnalysis({
      plantId: "plant-1",
      requestId: "req-1",
    });

    expect(result?.analysis?.summary).toBe("Plant is trending better.");
    expect(analyzeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageId: "image-current",
        previousImageId: "image-previous",
        previousStoragePath: "plant-1/previous.jpg",
        requestId: "req-1",
        storagePath: "plant-1/current.jpg",
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis_mode: "model",
        compared_to_image_id: "image-previous",
        image_id: "image-current",
        overall_health_score: 92,
      }),
      { onConflict: "image_id" },
    );
    expect(deleteEq).toHaveBeenCalledWith("image_id", "image-current");
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        category: "positive",
        confidence_score: 0.92,
        image_id: "image-current",
        recommendation: "Maintain current environment.",
        title: "Improved posture",
      }),
    ]);
    expect(persistFindingEmbeddings).toHaveBeenCalledWith(
      { from },
      [
        expect.objectContaining({
          id: "finding-1",
          category: "positive",
          title: "Improved posture",
        }),
      ],
      { requestId: "req-1" },
    );
    now.mockRestore();
  });

  it("keeps analysis successful when semantic embedding persistence fails", async () => {
    persistFindingEmbeddings.mockResolvedValue({
      code: "embedding_unavailable",
      failed: 1,
      generated: 0,
      ok: false,
      skipped: 0,
      updated: 0,
    });
    analyzeImage.mockResolvedValue({
      analysisMode: "model",
      analyzedAt: "2026-05-11T00:00:00Z",
      findings: [
        {
          category: "general",
          description: "Needs review.",
          severity: "info",
          title: "Observation",
        },
      ],
      imageId: "image-current",
      isFallback: false,
      modelVersion: "gpt-4o-mini-vision",
      overallHealthScore: 70,
      plantId: "plant-1",
      requestId: "analysis-req",
      summary: "Review recommended.",
    });
    const db = makeAnalysisPersistenceDb();
    getDbClient.mockReturnValue({ from: db.from });

    await expect(
      runAndPersistPlantAnalysis({
        plantId: "plant-1",
        requestId: "req-1",
      }),
    ).resolves.toMatchObject({
      analysis: { summary: "Review recommended." },
    });
    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      "plant analysis: finding embeddings skipped",
      expect.objectContaining({ code: "embedding_unavailable" }),
    );
  });

  it.each([
    [
      "analysis upsert",
      { upsertError: "upsert down" },
      "Failed to persist plant analysis: upsert down",
    ],
    [
      "finding deletion",
      { deleteError: "delete down" },
      "Failed to replace plant findings: delete down",
    ],
    [
      "finding insert",
      { findingError: "insert down" },
      "Failed to persist plant findings: insert down",
    ],
  ])(
    "throws when %s fails during analysis persistence",
    async (_label, dbErrors, message) => {
      analyzeImage.mockResolvedValue({
        analysisMode: "model",
        analyzedAt: "2026-05-11T00:00:00Z",
        findings: [
          {
            category: "general",
            description: "Needs review.",
            severity: "info",
            title: "Observation",
          },
        ],
        imageId: "image-current",
        isFallback: false,
        modelVersion: "gpt-4o-mini-vision",
        overallHealthScore: 70,
        plantId: "plant-1",
        requestId: "analysis-req",
        summary: "Review recommended.",
      });
      const db = makeAnalysisPersistenceDb(dbErrors);
      getDbClient.mockReturnValue({ from: db.from });

      await expect(
        runAndPersistPlantAnalysis({
          plantId: "plant-1",
          requestId: "req-1",
        }),
      ).rejects.toThrow(message);
    },
  );
});
