import { NextRequest, NextResponse } from "next/server";
import type { AnalysisResponse } from "@phenosage/shared";
import { getServerUser } from "@/lib/server/auth";
import { getDbClient } from "@/lib/server/db";
import { authorizePlantAccess } from "@/lib/server/authorization";
import { correlationIdFromRequest } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

/**
 * GET /api/plants/[plantId]/analysis/latest
 *
 * Returns the most recent stored analysis for the plant plus the findings that
 * were captured with it. Returns { analysis: null } when no analysis has run.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = correlationIdFromRequest(request);
  const user = await getServerUser();
  if (!user) return errJson("Unauthorized", 401, requestId);

  const { plantId } = await params;
  const access = await authorizePlantAccess(user.id, plantId);
  if (!access) return errJson("Plant not found", 404, requestId);

  const db = getDbClient();

  const { data: analysisRow, error: analysisErr } = await db
    .from("plant_analyses")
    .select(
      "id, plant_id, image_id, overall_health_score, summary, compared_to_image_id, comparison_summary, model_version, analyzed_at",
    )
    .eq("plant_id", access.plantId)
    .order("analyzed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (analysisErr) return errJson("Query failed", 500, requestId);

  if (!analysisRow) {
    return NextResponse.json(
      {
        plantId: access.plantId,
        analysis: null,
        requestId,
      },
      { status: 200, headers: { "x-request-id": requestId } },
    );
  }

  const { data: findings } = await db
    .from("plant_findings")
    .select("category, severity, title, description, recommendation")
    .eq("image_id", analysisRow.image_id as string)
    .order("created_at", { ascending: true });

  const analysis: AnalysisResponse = {
    plantId: analysisRow.plant_id as string,
    imageId: analysisRow.image_id as string,
    overallHealthScore: Number(analysisRow.overall_health_score),
    summary: analysisRow.summary as string,
    findings: (findings ?? []).map((f) => ({
      category: f.category as AnalysisResponse["findings"][number]["category"],
      severity: f.severity as AnalysisResponse["findings"][number]["severity"],
      title: f.title as string,
      description: f.description as string,
      ...(f.recommendation
        ? { recommendation: f.recommendation as string }
        : {}),
    })),
    analyzedAt: analysisRow.analyzed_at as string,
    modelVersion: analysisRow.model_version as string,
    ...(analysisRow.compared_to_image_id
      ? { comparedToImageId: analysisRow.compared_to_image_id as string }
      : {}),
    ...(analysisRow.comparison_summary
      ? { comparisonSummary: analysisRow.comparison_summary as string }
      : {}),
  };

  return NextResponse.json(
    { plantId: access.plantId, analysis, requestId },
    { status: 200, headers: { "x-request-id": requestId } },
  );
}

function errJson(message: string, status: number, requestId: string) {
  return NextResponse.json(
    { error: message, requestId },
    { status, headers: { "x-request-id": requestId } },
  );
}
