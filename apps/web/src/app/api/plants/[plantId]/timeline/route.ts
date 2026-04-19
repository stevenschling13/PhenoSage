import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/server/auth";
import { getDbClient } from "@/lib/server/db";
import { authorizePlantAccess } from "@/lib/server/authorization";
import { correlationIdFromRequest } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

interface TimelineEntry {
  kind: "image" | "observation" | "finding";
  id: string;
  at: string;
  payload: Record<string, unknown>;
}

/**
 * GET /api/plants/[plantId]/timeline
 * Returns a merged, time-ordered list of plant_images, plant_observations,
 * and plant_findings for the plant. Empty collections are returned as `[]`.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = correlationIdFromRequest(request);
  const user = await getServerUser();
  if (!user) return errJson("Unauthorized", 401, requestId);

  const { plantId } = await params;
  const access = await authorizePlantAccess(user.id, plantId);
  if (!access) return errJson("Plant not found", 404, requestId);

  const db = getDbClient();

  const [imagesRes, obsRes, findingsRes] = await Promise.all([
    db
      .from("plant_images")
      .select("id, storage_path, taken_at, source, notes, created_at")
      .eq("plant_id", access.plantId)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("plant_observations")
      .select("id, observed_at, height_cm, notes, created_at")
      .eq("plant_id", access.plantId)
      .order("observed_at", { ascending: false })
      .limit(50),
    db
      .from("plant_findings")
      .select(
        "id, category, severity, title, description, recommendation, image_id, created_at",
      )
      .eq("plant_id", access.plantId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (imagesRes.error || obsRes.error || findingsRes.error) {
    return errJson("Query failed", 500, requestId);
  }

  const items: TimelineEntry[] = [];

  for (const img of imagesRes.data ?? []) {
    items.push({
      kind: "image",
      id: img.id as string,
      at: (img.taken_at as string | null) ?? (img.created_at as string),
      payload: {
        storagePath: img.storage_path as string,
        source: img.source as string,
        notes: (img.notes as string | null) ?? undefined,
      },
    });
  }
  for (const obs of obsRes.data ?? []) {
    items.push({
      kind: "observation",
      id: obs.id as string,
      at: (obs.observed_at as string) ?? (obs.created_at as string),
      payload: {
        heightCm: obs.height_cm ?? undefined,
        notes: (obs.notes as string | null) ?? undefined,
      },
    });
  }
  for (const f of findingsRes.data ?? []) {
    items.push({
      kind: "finding",
      id: f.id as string,
      at: f.created_at as string,
      payload: {
        category: f.category,
        severity: f.severity,
        title: f.title,
        description: f.description,
        recommendation: (f.recommendation as string | null) ?? undefined,
        imageId: (f.image_id as string | null) ?? undefined,
      },
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return NextResponse.json(
    {
      plantId: access.plantId,
      items: items.slice(0, 100),
      counts: {
        images: imagesRes.data?.length ?? 0,
        observations: obsRes.data?.length ?? 0,
        findings: findingsRes.data?.length ?? 0,
      },
      requestId,
    },
    { status: 200, headers: { "x-request-id": requestId } },
  );
}

function errJson(message: string, status: number, requestId: string) {
  return NextResponse.json(
    { error: message, requestId },
    { status, headers: { "x-request-id": requestId } },
  );
}
