import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/server/auth";
import { getDbClient } from "@/lib/server/db";
import { authorizePlantAccess } from "@/lib/server/authorization";
import { loadGrowContext } from "@/lib/server/plant-context";
import {
  analyzeImage,
  AnalysisServiceError,
} from "@/lib/server/analysis-proxy";
import { correlationIdFromRequest, createLogger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

/**
 * POST /api/plants/[plantId]/analyze
 *
 * Body: { imageId: uuid } — the plant_images row to analyze.
 *
 * Flow:
 *   1. Authorize the user against the plant.
 *   2. Load the image row + optional previous image.
 *   3. Build a GrowContext snapshot.
 *   4. Call the FastAPI analysis service via the proxy.
 *   5. Persist AnalysisResponse to plant_analyses and findings to plant_findings.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = correlationIdFromRequest(request);
  const log = createLogger({ route: "api.plants.analyze", requestId });

  const user = await getServerUser();
  if (!user) return errJson("Unauthorized", 401, requestId);

  const { plantId } = await params;
  const access = await authorizePlantAccess(user.id, plantId);
  if (!access) return errJson("Plant not found", 404, requestId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errJson("Invalid JSON body", 400, requestId);
  }
  const imageId =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)["imageId"]
      : undefined;
  if (typeof imageId !== "string") {
    return errJson("imageId is required", 400, requestId);
  }

  const db = getDbClient();
  const { data: image, error: imageErr } = await db
    .from("plant_images")
    .select("id, plant_id, grow_id, storage_path, created_at")
    .eq("id", imageId)
    .eq("plant_id", access.plantId)
    .maybeSingle();
  if (imageErr || !image) return errJson("Image not found", 404, requestId);

  const { data: prev } = await db
    .from("plant_images")
    .select("id, storage_path")
    .eq("plant_id", access.plantId)
    .lt("created_at", image.created_at as string)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const growCtx = await loadGrowContext(access.plantId, access.growId);

  let analysis;
  try {
    const params: Parameters<typeof analyzeImage>[0] = {
      plantId: access.plantId,
      imageId: image.id as string,
      storagePath: image.storage_path as string,
      growContext: growCtx,
      requestId,
    };
    if (prev?.id) params.previousImageId = prev.id as string;
    if (prev?.storage_path) {
      params.previousStoragePath = prev.storage_path as string;
    }
    analysis = await analyzeImage(params);
  } catch (err) {
    const status = err instanceof AnalysisServiceError ? err.status : 500;
    log.error("analysis service call failed", {
      imageId: image.id,
      status,
      error: err instanceof Error ? err.message : String(err),
    });
    return errJson("Analysis failed", status >= 500 ? 502 : status, requestId);
  }

  const { data: savedAnalysis, error: saveErr } = await db
    .from("plant_analyses")
    .insert({
      plant_id: access.plantId,
      grow_id: access.growId,
      image_id: image.id,
      overall_health_score: analysis.overallHealthScore,
      summary: analysis.summary,
      compared_to_image_id: analysis.comparedToImageId ?? null,
      comparison_summary: analysis.comparisonSummary ?? null,
      model_version: analysis.modelVersion,
      analyzed_at: analysis.analyzedAt,
    })
    .select("id")
    .single();

  if (saveErr || !savedAnalysis) {
    log.error("plant_analyses insert failed", {
      imageId: image.id,
      error: saveErr?.message,
    });
  }

  if (analysis.findings.length > 0) {
    const findingRows = analysis.findings.map((f) => ({
      plant_id: access.plantId,
      grow_id: access.growId,
      image_id: image.id,
      category: f.category,
      severity: f.severity,
      title: f.title,
      description: f.description,
      recommendation: f.recommendation ?? null,
    }));
    const { error: findErr } = await db
      .from("plant_findings")
      .insert(findingRows);
    if (findErr) {
      log.error("plant_findings insert failed", {
        imageId: image.id,
        error: findErr.message,
      });
    }
  }

  log.info("analysis stored", {
    imageId: image.id,
    analysisId: savedAnalysis?.id,
    score: analysis.overallHealthScore,
    findings: analysis.findings.length,
  });

  return NextResponse.json(
    { analysis, requestId },
    { status: 201, headers: { "x-request-id": requestId } },
  );
}
function errJson(message: string, status: number, requestId: string) {
  return NextResponse.json(
    { error: message, requestId },
    { status, headers: { "x-request-id": requestId } },
  );
}
