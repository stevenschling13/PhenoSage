import "server-only";
import type { AnalysisFinding, AnalysisResponse } from "@phenosage/shared";
import { analyzeImage, type AnalyzeGrowContext } from "./analysis-proxy";
import { createSupabaseServerClient } from "./auth";
import { getAuthorizedPlantContext } from "./plant-access";
import { getDbClient } from "./db";
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
  title: string;
  description: string;
  recommendation: string | null;
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

  const findings = ((findingRows ?? []) as PlantFindingRow[]).map((row) => {
    const finding: AnalysisFinding = {
      category: row.category,
      severity: row.severity,
      title: row.title,
      description: row.description,
    };
    if (row.recommendation) {
      finding.recommendation = row.recommendation;
    }
    return finding;
  });

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
    const finding: AnalysisFinding = {
      category: row.category,
      severity: row.severity,
      title: row.title,
      description: row.description,
    };
    if (row.recommendation) {
      finding.recommendation = row.recommendation;
    }
    current.push(finding);
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

  const { error: upsertError } = await db.from("plant_analyses").upsert(
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
  );

  if (upsertError) {
    throw new Error(`Failed to persist plant analysis: ${upsertError.message}`);
  }

  const { error: deleteError } = await db
    .from("plant_findings")
    .delete()
    .eq("image_id", currentImage.id);

  if (deleteError) {
    throw new Error(`Failed to replace plant findings: ${deleteError.message}`);
  }

  if (analysis.findings.length) {
    const { error: findingError } = await db.from("plant_findings").insert(
      analysis.findings.map((finding) => ({
        plant_id: context.plantId,
        grow_id: context.growId,
        image_id: currentImage.id,
        category: finding.category,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        recommendation: finding.recommendation ?? null,
      })),
    );

    if (findingError) {
      throw new Error(
        `Failed to persist plant findings: ${findingError.message}`,
      );
    }
  }

  logServerEvent("info", "plant analysis persisted", {
    requestId: params.requestId,
    plantId: context.plantId,
    imageId: currentImage.id,
    analysisMode: analysis.analysisMode,
    isFallback: analysis.isFallback,
  });

  return { context, analysis };
}
