import "server-only";
import type {
  AnalysisFinding,
  AnalysisResponse,
  GrowTask,
} from "@phenosage/shared";
import { analyzeImage, type AnalyzeGrowContext } from "./analysis-proxy";
import { createSupabaseServerClient } from "./auth";
import { getAuthorizedPlantContext } from "./plant-access";
import { getDbClient } from "./db";
import { persistFindingEmbeddings } from "./embeddings";
import { logServerEvent } from "./request-id";
import { getStorageClient } from "./storage";

type PlantImageRow = {
  id: string;
  plant_id: string;
  grow_id: string;
  user_id: string;
  storage_path: string;
  taken_at: string | null;
  source: "camera" | "upload";
  notes: string | null;
  created_at: string;
};

type PlantAnalysisRow = {
  id: string;
  plant_id: string;
  grow_id: string;
  image_id: string;
  compared_to_image_id: string | null;
  overall_health_score: number;
  summary: string;
  comparison_summary: string | null;
  analyzed_at: string;
  model_version: string;
  analysis_mode: "fallback" | "model";
  is_fallback: boolean;
  fallback_reason: string | null;
  request_id: string | null;
  created_at: string;
};

type PlantFindingRow = {
  id: string;
  plant_id: string;
  grow_id: string;
  image_id: string | null;
  category: AnalysisFinding["category"];
  severity: AnalysisFinding["severity"];
  confidence_score: number | null;
  title: string;
  description: string;
  recommendation: string | null;
  source: NonNullable<AnalysisFinding["source"]>;
  resolution_state: NonNullable<AnalysisFinding["resolutionState"]>;
  resolution_note: string | null;
  created_at: string;
};

type PlantObservationRow = {
  id: string;
  observed_at: string;
  height_cm: number | null;
  notes: string | null;
  created_at: string;
};

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
}

function daysSinceStart(startDate: string | null): number | undefined {
  if (!startDate) {
    return undefined;
  }
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    return undefined;
  }
  const diffMs = Date.now() - start.getTime();
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

function mapAnalysisFromRow(
  row: PlantAnalysisRow,
  findings: AnalysisFinding[],
): AnalysisResponse {
  const analysis: AnalysisResponse = {
    plantId: row.plant_id,
    imageId: row.image_id,
    overallHealthScore: row.overall_health_score,
    summary: row.summary,
    findings,
    analyzedAt: row.analyzed_at,
    modelVersion: row.model_version,
    analysisMode: row.analysis_mode,
    isFallback: row.is_fallback,
  };

  if (row.compared_to_image_id) {
    analysis.comparedToImageId = row.compared_to_image_id;
  }
  if (row.comparison_summary) {
    analysis.comparisonSummary = row.comparison_summary;
  }
  if (row.fallback_reason) {
    analysis.fallbackReason = row.fallback_reason;
  }
  if (row.request_id) {
    analysis.requestId = row.request_id;
  }

  return analysis;
}

function mapFindingFromRow(row: PlantFindingRow): AnalysisFinding {
  const finding: AnalysisFinding = {
    id: row.id,
    category: row.category,
    severity: row.severity,
    title: row.title,
    description: row.description,
    source: row.source,
    resolutionState: row.resolution_state,
  };

  if (row.recommendation) {
    finding.recommendation = row.recommendation;
  }
  if (row.confidence_score !== null) {
    finding.confidenceScore = row.confidence_score;
  }
  if (row.resolution_note) {
    finding.resolutionNote = row.resolution_note;
  }

  return finding;
}

export async function preparePlantImageUpload(params: {
  plantId: string;
  fileName: string;
  contentType: string;
  requestId: string;
}) {
  const context = await getAuthorizedPlantContext(params.plantId);
  if (!context) {
    return null;
  }

  const imageId = crypto.randomUUID();
  const storagePath = `${params.plantId}/${Date.now()}-${imageId}-${sanitizeFileName(params.fileName)}`;

  const storage = getStorageClient();
  const { data: uploadData, error: uploadError } = await storage
    .from("plant-images")
    .createSignedUploadUrl(storagePath);

  if (uploadError) {
    throw new Error(
      `Failed to create signed upload URL: ${uploadError.message}`,
    );
  }

  logServerEvent("info", "plant image upload prepared", {
    requestId: params.requestId,
    plantId: context.plantId,
    imageId,
  });

  return {
    imageId,
    plantId: context.plantId,
    storagePath,
    token: uploadData.token,
  };
}

export async function persistPlantImageUpload(params: {
  imageId: string;
  notes?: string;
  plantId: string;
  source?: "camera" | "upload";
  storagePath: string;
  takenAt?: string;
}) {
  const context = await getAuthorizedPlantContext(params.plantId);
  if (!context) {
    return null;
  }

  if (!params.storagePath.startsWith(`${context.plantId}/`)) {
    throw new Error("Upload path does not match the requested plant.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("plant_images").insert({
    grow_id: context.growId,
    id: params.imageId,
    notes: params.notes ?? null,
    plant_id: context.plantId,
    source: params.source ?? "upload",
    storage_path: params.storagePath,
    taken_at: params.takenAt ?? null,
    user_id: context.userId,
  });

  if (error) {
    throw new Error(`Failed to persist plant image metadata: ${error.message}`);
  }

  return {
    imageId: params.imageId,
    plantId: context.plantId,
    storagePath: params.storagePath,
  };
}

/**
 * Mint a fresh signed download URL for a single plant image.
 *
 * Used by the `<SignedImage>` client component's refresh path: when a
 * previously-rendered signed URL expires (Supabase 403), the component
 * calls `/api/uploads/refresh`, which calls this. Ownership is
 * enforced two ways:
 *
 *   1. `getAuthorizedPlantContext` checks the caller actually owns /
 *      is a member of the grow that contains the plant.
 *   2. The `plant_images` lookup is bounded by `plant_id = context.plantId`
 *      so a caller who owns plant A cannot pass image B (belonging to
 *      plant B) and harvest a fresh URL.
 *
 * Returns `null` whenever auth or lookup fails. The caller maps that
 * to a 404 so the existence (or non-existence) of an image id is not
 * disclosed to unauthorised parties.
 */
export async function signPlantImageUrl(params: {
  plantId: string;
  imageId: string;
  /** TTL for the new signed URL, in seconds. Capped at 1 hour. */
  expiresInSeconds?: number;
}): Promise<{ signedUrl: string; expiresAt: string } | null> {
  const context = await getAuthorizedPlantContext(params.plantId);
  if (!context) {
    return null;
  }

  const db = getDbClient();
  const { data: image, error: imageError } = await db
    .from("plant_images")
    .select("storage_path")
    .eq("id", params.imageId)
    .eq("plant_id", context.plantId)
    .maybeSingle();
  if (imageError) {
    throw new Error(`Failed to load image for signing: ${imageError.message}`);
  }
  if (!image) {
    return null;
  }

  // Clamp the TTL so a misbehaving client can't request a year-long
  // signed URL. 60s minimum prevents thrashing if a client retries on
  // every error.
  //
  // Defense-in-depth: the route handler already filters non-finite
  // input, but the helper guards itself against `NaN` / `Infinity`
  // anyway. A NaN here would propagate through the clamp and then
  // explode at `new Date(Date.now() + NaN).toISOString()` with
  // `RangeError: Invalid time value`, taking down the whole request.
  const requested = params.expiresInSeconds ?? 600;
  const safeRequested = Number.isFinite(requested)
    ? Math.floor(requested)
    : 600;
  const expiresIn = Math.max(60, Math.min(3600, safeRequested));

  const storage = getStorageClient().from("plant-images");
  const { data, error } = await storage.createSignedUrl(
    (image as { storage_path: string }).storage_path,
    expiresIn,
  );
  if (error || !data?.signedUrl) {
    throw new Error(
      `Failed to sign plant image URL: ${error?.message ?? "no url"}`,
    );
  }

  return {
    signedUrl: data.signedUrl,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export async function getLatestPlantAnalysis(
  plantId: string,
): Promise<AnalysisResponse | null> {
  const context = await getAuthorizedPlantContext(plantId);
  if (!context) {
    return null;
  }

  const db = getDbClient();
  const { data: analysisRow, error: analysisError } = await db
    .from("plant_analyses")
    .select("*")
    .eq("plant_id", context.plantId)
    .order("analyzed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (analysisError) {
    // Degrade to "no analysis yet" rather than crashing the plant detail
    // page. The underlying error is captured for diagnosis via server logs.
    logServerEvent("error", "latest plant analysis query failed", {
      plantId: context.plantId,
      error: analysisError.message,
    });
    return null;
  }

  const persisted = analysisRow as PlantAnalysisRow | null;
  if (!persisted) {
    return null;
  }

  const { data: findingRows, error: findingError } = await db
    .from("plant_findings")
    .select("*")
    .eq("image_id", persisted.image_id)
    .order("created_at", { ascending: true });

  if (findingError) {
    logServerEvent("error", "latest plant analysis findings query failed", {
      plantId: context.plantId,
      imageId: persisted.image_id,
      error: findingError.message,
    });
    return mapAnalysisFromRow(persisted, []);
  }

  const findings = ((findingRows ?? []) as PlantFindingRow[]).map(
    mapFindingFromRow,
  );

  return mapAnalysisFromRow(persisted, findings);
}

export async function getPlantTimeline(plantId: string) {
  const context = await getAuthorizedPlantContext(plantId);
  if (!context) {
    return null;
  }

  const db = getDbClient();
  // Run the four reads independently so a missing table, RLS denial, or
  // transient blip on one source degrades just that source to empty
  // instead of taking down the entire plant detail view.
  const [imagesSettled, observationsSettled, analysesSettled, findingsSettled] =
    await Promise.allSettled([
      db
        .from("plant_images")
        .select("*")
        .eq("plant_id", context.plantId)
        .order("created_at", { ascending: false }),
      db
        .from("plant_observations")
        .select("*")
        .eq("plant_id", context.plantId)
        .order("observed_at", { ascending: false }),
      db
        .from("plant_analyses")
        .select("*")
        .eq("plant_id", context.plantId)
        .order("analyzed_at", { ascending: false }),
      db
        .from("plant_findings")
        .select("*")
        .eq("plant_id", context.plantId)
        .order("created_at", { ascending: true }),
    ]);

  function unwrap<T>(
    label: string,
    settled: PromiseSettledResult<{
      data: T[] | null;
      error: { message: string } | null;
    }>,
  ): T[] {
    if (settled.status === "rejected") {
      logServerEvent("error", "plant timeline query rejected", {
        plantId: context!.plantId,
        source: label,
        error:
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason),
      });
      return [];
    }
    if (settled.value.error) {
      logServerEvent("error", "plant timeline query failed", {
        plantId: context!.plantId,
        source: label,
        error: settled.value.error.message,
      });
      return [];
    }
    return settled.value.data ?? [];
  }

  const imageRows = unwrap<PlantImageRow>("plant_images", imagesSettled);
  const observationRows = unwrap<PlantObservationRow>(
    "plant_observations",
    observationsSettled,
  );
  const analysisRows = unwrap<PlantAnalysisRow>(
    "plant_analyses",
    analysesSettled,
  );
  const findingRows = unwrap<PlantFindingRow>(
    "plant_findings",
    findingsSettled,
  );

  const findingsByImage = new Map<string, AnalysisFinding[]>();
  for (const row of findingRows) {
    if (!row.image_id) {
      continue;
    }
    const current = findingsByImage.get(row.image_id) ?? [];
    current.push(mapFindingFromRow(row));
    findingsByImage.set(row.image_id, current);
  }

  const analysesByImage = new Map<string, AnalysisResponse>();
  for (const row of analysisRows) {
    analysesByImage.set(
      row.image_id,
      mapAnalysisFromRow(row, findingsByImage.get(row.image_id) ?? []),
    );
  }

  const imageItems = imageRows.map((row) => ({
    type: "image" as const,
    id: row.id,
    createdAt: row.created_at,
    takenAt: row.taken_at ?? row.created_at,
    source: row.source,
    notes: row.notes ?? undefined,
    storagePath: row.storage_path,
    analysis: analysesByImage.get(row.id) ?? null,
    findings: findingsByImage.get(row.id) ?? [],
  }));

  const observationItems = observationRows.map((row) => ({
    type: "observation" as const,
    id: row.id,
    observedAt: row.observed_at,
    createdAt: row.created_at,
    heightCm: row.height_cm ?? undefined,
    notes: row.notes ?? undefined,
  }));

  const items = [...imageItems, ...observationItems].sort((left, right) => {
    const leftTime =
      left.type === "image"
        ? new Date(left.takenAt).getTime()
        : new Date(left.observedAt).getTime();
    const rightTime =
      right.type === "image"
        ? new Date(right.takenAt).getTime()
        : new Date(right.observedAt).getTime();
    return rightTime - leftTime;
  });

  return {
    plantId: context.plantId,
    items,
  };
}

export async function runAndPersistPlantAnalysis(params: {
  plantId: string;
  imageId?: string;
  requestId: string;
}) {
  const context = await getAuthorizedPlantContext(params.plantId);
  if (!context) {
    return null;
  }

  const db = getDbClient();
  const { data: imageRows, error: imageError } = await db
    .from("plant_images")
    .select("*")
    .eq("plant_id", context.plantId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (imageError) {
    throw new Error(
      `Failed to load plant images for analysis: ${imageError.message}`,
    );
  }

  const images = (imageRows ?? []) as PlantImageRow[];
  const currentImage = params.imageId
    ? (images.find((row) => row.id === params.imageId) ?? null)
    : (images[0] ?? null);

  if (!currentImage) {
    return { context, analysis: null };
  }

  const previousImage =
    images.find((row) => row.id !== currentImage.id) ?? null;

  // Build the grow context by assignment so TypeScript's
  // `exactOptionalPropertyTypes` doesn't reject conditional spreads on
  // optional fields whose source is `T | undefined`.
  const growContext: AnalyzeGrowContext = { growId: context.growId };
  if (context.strain) growContext.strain = context.strain;
  if (context.growStage) growContext.stage = context.growStage;
  if (context.medium) growContext.medium = context.medium;
  if (context.lightType) growContext.lightType = context.lightType;
  const days = daysSinceStart(context.startDate);
  if (days !== undefined) growContext.daysSinceStart = days;
  if (context.notes) growContext.notes = context.notes;

  const analyzeParams: Parameters<typeof analyzeImage>[0] = {
    plantId: context.plantId,
    imageId: currentImage.id,
    storagePath: currentImage.storage_path,
    growContext,
    requestId: params.requestId,
  };
  if (previousImage?.id) analyzeParams.previousImageId = previousImage.id;
  if (previousImage?.storage_path) {
    analyzeParams.previousStoragePath = previousImage.storage_path;
  }

  const analysis = await analyzeImage(analyzeParams);

  const { data: upsertData, error: upsertError } = await db
    .from("plant_analyses")
    .upsert(
      {
        plant_id: context.plantId,
        grow_id: context.growId,
        image_id: currentImage.id,
        compared_to_image_id: analysis.comparedToImageId ?? null,
        overall_health_score: analysis.overallHealthScore,
        summary: analysis.summary,
        comparison_summary: analysis.comparisonSummary ?? null,
        analyzed_at: analysis.analyzedAt,
        model_version: analysis.modelVersion,
        analysis_mode: analysis.analysisMode ?? "fallback",
        is_fallback: analysis.isFallback ?? false,
        fallback_reason: analysis.fallbackReason ?? null,
        request_id: analysis.requestId ?? params.requestId,
      },
      { onConflict: "image_id" },
    )
    .select("id")
    .single();

  if (upsertError) {
    throw new Error(`Failed to persist plant analysis: ${upsertError.message}`);
  }
  const analysisId = (upsertData as { id: string } | null)?.id ?? null;

  const { error: deleteError } = await db
    .from("plant_findings")
    .delete()
    .eq("image_id", currentImage.id);

  if (deleteError) {
    throw new Error(`Failed to replace plant findings: ${deleteError.message}`);
  }

  if (analysis.findings.length) {
    const { data: insertedFindings, error: findingError } = await db
      .from("plant_findings")
      .insert(
        analysis.findings.map((finding) => ({
          plant_id: context.plantId,
          grow_id: context.growId,
          image_id: currentImage.id,
          category: finding.category,
          severity: finding.severity,
          source: "ai",
          confidence_score: finding.confidenceScore ?? null,
          title: finding.title,
          description: finding.description,
          recommendation: finding.recommendation ?? null,
        })),
      )
      .select("id,severity,title,description,recommendation,category");

    if (findingError) {
      throw new Error(
        `Failed to persist plant findings: ${findingError.message}`,
      );
    }

    // Tier-1 event-driven trigger: fan out finding_alert notifications
    // for high/critical severity findings immediately, instead of
    // waiting for the daily-summary cron at 8 AM. Best-effort — a
    // failure here is logged inside emitFindingAlerts and does NOT
    // propagate, because the analysis itself has already succeeded
    // and the user must still see their findings.
    type InsertedFinding = {
      id: string;
      severity: import("@phenosage/shared").FindingSeverity;
      title: string;
      description: string;
      recommendation: string | null;
      category: string;
    };
    const inserted = (insertedFindings ?? []) as InsertedFinding[];
    if (inserted.length > 0) {
      try {
        const embeddingResult = await persistFindingEmbeddings(
          db,
          inserted.map((f) => ({
            id: f.id,
            severity: f.severity,
            title: f.title,
            description: f.description,
            recommendation: f.recommendation,
            category: f.category,
          })),
          { requestId: params.requestId },
        );
        if (!embeddingResult.ok) {
          logServerEvent("warn", "plant analysis: finding embeddings skipped", {
            requestId: params.requestId,
            plantId: context.plantId,
            code: embeddingResult.code,
            failed: embeddingResult.failed,
          });
        }
      } catch (embeddingErr) {
        logServerEvent("warn", "plant analysis: finding embeddings threw", {
          requestId: params.requestId,
          plantId: context.plantId,
          error:
            embeddingErr instanceof Error
              ? embeddingErr.message
              : String(embeddingErr),
        });
      }

      try {
        const { emitFindingAlerts } = await import("./notifications");
        await emitFindingAlerts({
          userId: context.userId,
          requestId: params.requestId,
          findings: inserted.map((f) => ({
            findingId: f.id,
            plantId: context.plantId,
            growId: context.growId,
            severity: f.severity,
            title: f.title,
            description: f.description,
            recommendation: f.recommendation,
            category: f.category,
          })),
        });
      } catch (alertErr) {
        logServerEvent("warn", "plant analysis: alert emission threw", {
          requestId: params.requestId,
          plantId: context.plantId,
          error:
            alertErr instanceof Error ? alertErr.message : String(alertErr),
        });
      }
    }
  }

  logServerEvent("info", "plant analysis persisted", {
    requestId: params.requestId,
    plantId: context.plantId,
    imageId: currentImage.id,
    analysisMode: analysis.analysisMode,
    isFallback: analysis.isFallback,
  });

  return { context, analysis, analysisId, imageId: currentImage.id };
}

/**
 * Returns the plant id of the "Quick captures" plant in the given grow,
 * creating it on first use. Used by the chat upload flow when the user
 * snaps a picture without picking a specific plant — we still need a
 * plant_id (so the existing analysis pipeline + RLS policies work
 * unchanged) so we route those uploads to a per-grow inbox plant.
 *
 * Authorization: the caller must already have authenticated the grow_id
 * (we trust the caller; we don't re-check ownership here because the only
 * call site is inside the chat route after the user has picked a grow that
 * the loadGrowContextSummary RLS-gated query already returned).
 */
export async function getOrCreateQuickCapturePlant(params: {
  growId: string;
}): Promise<{ plantId: string } | null> {
  const db = getDbClient();
  const { data: existing, error: lookupError } = await db
    .from("plants")
    .select("id")
    .eq("grow_id", params.growId)
    .eq("name", "Quick captures")
    .maybeSingle();
  if (lookupError) {
    logServerEvent("error", "quick capture plant lookup failed", {
      growId: params.growId,
      error: lookupError.message,
    });
    return null;
  }
  if (existing) {
    return { plantId: (existing as { id: string }).id };
  }
  const { data: created, error: insertError } = await db
    .from("plants")
    .insert({
      grow_id: params.growId,
      name: "Quick captures",
      notes:
        "Auto-created inbox for images uploaded in chat without a specific plant.",
    })
    .select("id")
    .single();
  if (insertError || !created) {
    logServerEvent("error", "quick capture plant create failed", {
      growId: params.growId,
      error: insertError?.message ?? "no row",
    });
    return null;
  }
  return { plantId: (created as { id: string }).id };
}

// ─── Plant Passport ────────────────────────────────────────────────────────
//
// Unified chronological view of everything that has happened to a plant:
// images (with their findings + analysis), grower observations, and the
// grow_tasks the AI/user have spawned. Sorted newest-first so the freshest
// activity is at the top.
//
// Reuses `getPlantTimeline` for images + observations rather than
// duplicating the four-table fetch. Tasks are fetched separately because
// the existing timeline contract intentionally scopes to images +
// observations only — extending it would ripple into the plant detail
// page and the dashboard.

type PassportImageItem = {
  type: "image";
  occurredAt: string;
  id: string;
  createdAt: string;
  takenAt: string;
  source: string;
  notes?: string;
  storagePath: string;
  analysis: AnalysisResponse | null;
  findings: AnalysisFinding[];
};

type PassportObservationItem = {
  type: "observation";
  occurredAt: string;
  id: string;
  observedAt: string;
  createdAt: string;
  heightCm?: number;
  notes?: string;
};

type PassportTaskItem = {
  type: "task";
  occurredAt: string;
  task: GrowTask;
};

export type PlantPassportItem =
  | PassportImageItem
  | PassportObservationItem
  | PassportTaskItem;

type GrowTaskRow = {
  id: string;
  grow_id: string;
  plant_id: string | null;
  finding_id: string | null;
  title: string;
  description: string | null;
  priority: GrowTask["priority"];
  status: GrowTask["status"];
  due_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function mapTaskFromRow(row: GrowTaskRow): GrowTask {
  const task: GrowTask = {
    id: row.id,
    growId: row.grow_id,
    title: row.title,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.plant_id) task.plantId = row.plant_id;
  if (row.finding_id) task.findingId = row.finding_id;
  if (row.description) task.description = row.description;
  if (row.due_at) task.dueAt = row.due_at;
  if (row.completed_at) task.completedAt = row.completed_at;
  return task;
}

export async function getPlantPassport(plantId: string) {
  const context = await getAuthorizedPlantContext(plantId);
  if (!context) {
    return null;
  }

  // Run both reads concurrently — the timeline already fans out four
  // queries internally, so we don't gain from sequencing.
  const db = getDbClient();
  const [timeline, taskResult] = await Promise.all([
    getPlantTimeline(plantId),
    db
      .from("grow_tasks")
      .select("*")
      .eq("plant_id", context.plantId)
      .order("created_at", { ascending: false }),
  ]);

  if (!timeline) {
    return null;
  }

  let tasks: GrowTask[] = [];
  if (taskResult.error) {
    // Soft-degrade: missing tasks don't take down the passport.
    logServerEvent("error", "plant passport tasks query failed", {
      plantId: context.plantId,
      error: taskResult.error.message,
    });
  } else {
    tasks = ((taskResult.data ?? []) as GrowTaskRow[]).map(mapTaskFromRow);
  }

  // Hoist each timeline item's "occurred at" so we can sort the merged
  // stream by a single key without re-discriminating on type every loop.
  // Explicit construction avoids exactOptionalPropertyTypes mismatches when
  // spreading items whose `notes` is typed `string | undefined`.
  const fromTimeline: PlantPassportItem[] = timeline.items.map(
    (item): PlantPassportItem => {
      if (item.type === "image") {
        const out: PassportImageItem = {
          type: "image",
          occurredAt: item.takenAt,
          id: item.id,
          createdAt: item.createdAt,
          takenAt: item.takenAt,
          source: item.source,
          storagePath: item.storagePath,
          analysis: item.analysis,
          findings: item.findings,
        };
        if (item.notes !== undefined) out.notes = item.notes;
        return out;
      }
      const out: PassportObservationItem = {
        type: "observation",
        occurredAt: item.observedAt,
        id: item.id,
        observedAt: item.observedAt,
        createdAt: item.createdAt,
      };
      if (item.heightCm !== undefined) out.heightCm = item.heightCm;
      if (item.notes !== undefined) out.notes = item.notes;
      return out;
    },
  );
  const fromTasks: PlantPassportItem[] = tasks.map((task) => ({
    type: "task",
    occurredAt: task.createdAt,
    task,
  }));

  const items = [...fromTimeline, ...fromTasks].sort(
    (left, right) =>
      new Date(right.occurredAt).getTime() -
      new Date(left.occurredAt).getTime(),
  );

  // Pending = "needs your review"; surfaced as the lead callout so the
  // grower knows the ledger isn't empty.
  const pendingFindingCount = timeline.items.reduce((count, item) => {
    if (item.type !== "image") return count;
    return (
      count +
      item.findings.filter((f) => f.resolutionState === "pending").length
    );
  }, 0);

  const openTaskCount = tasks.filter(
    (t) => t.status === "open" || t.status === "in_progress",
  ).length;

  return {
    plantId: context.plantId,
    plantName: context.plantName,
    items,
    pendingFindingCount,
    openTaskCount,
  };
}
