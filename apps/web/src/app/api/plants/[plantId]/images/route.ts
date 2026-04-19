import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/server/auth";
import { getDbClient } from "@/lib/server/db";
import { authorizePlantAccess } from "@/lib/server/authorization";
import { correlationIdFromRequest, createLogger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "plant-images";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

/**
 * POST /api/plants/[plantId]/images
 *
 * Called by the browser after a successful direct upload to Supabase Storage.
 * Verifies that the uploaded path is under the authorized grow/plant prefix,
 * then inserts a plant_images row via the service role.
 *
 * Body: { storagePath: string, takenAt?: ISO string, notes?: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = correlationIdFromRequest(request);
  const log = createLogger({ route: "api.plants.images.post", requestId });

  const user = await getServerUser();
  if (!user) return errorJson("Unauthorized", 401, requestId);

  const { plantId } = await params;
  const access = await authorizePlantAccess(user.id, plantId);
  if (!access) return errorJson("Plant not found", 404, requestId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400, requestId);
  }
  if (!body || typeof body !== "object") {
    return errorJson("body must be an object", 400, requestId);
  }
  const v = body as Record<string, unknown>;
  const storagePath = v["storagePath"];
  if (typeof storagePath !== "string" || storagePath.length < 3) {
    return errorJson("storagePath is required", 400, requestId);
  }
  const expectedPrefix = `${access.growId}/${access.plantId}/`;
  if (!storagePath.startsWith(expectedPrefix)) {
    return errorJson(
      "storagePath does not match authorized plant scope",
      400,
      requestId,
    );
  }

  const notes = typeof v["notes"] === "string" ? (v["notes"] as string) : null;
  const takenAt =
    typeof v["takenAt"] === "string" ? (v["takenAt"] as string) : null;

  // Confirm the object actually landed in storage before we record it.
  const db = getDbClient();
  const verified = await verifyObjectExists(db, storagePath);
  if (!verified) {
    log.warn("upload not found in storage", { storagePath });
    return errorJson("Uploaded object not found", 404, requestId);
  }

  const { data, error } = await db
    .from("plant_images")
    .insert({
      plant_id: access.plantId,
      grow_id: access.growId,
      user_id: user.id,
      storage_path: storagePath,
      source: "upload",
      notes,
      taken_at: takenAt,
    })
    .select(
      "id, plant_id, grow_id, user_id, storage_path, taken_at, source, notes, created_at",
    )
    .single();

  if (error || !data) {
    log.error("plant_images insert failed", {
      plantId: access.plantId,
      error: error?.message,
    });
    return errorJson("Could not persist image", 500, requestId);
  }

  log.info("plant image recorded", {
    plantId: access.plantId,
    imageId: data.id,
    userId: user.id,
  });

  return NextResponse.json(
    {
      image: {
        id: data.id as string,
        plantId: data.plant_id as string,
        growId: data.grow_id as string,
        userId: data.user_id as string,
        storagePath: data.storage_path as string,
        takenAt: (data.taken_at as string | null) ?? undefined,
        source: data.source as string,
        notes: (data.notes as string | null) ?? undefined,
        createdAt: data.created_at as string,
      },
      requestId,
    },
    { status: 201, headers: { "x-request-id": requestId } },
  );
}

/**
 * GET /api/plants/[plantId]/images
 *
 * Returns the plant's images ordered by created_at desc.
 * Read-only sibling of POST; shares the same auth check.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = correlationIdFromRequest(request);

  const user = await getServerUser();
  if (!user) return errorJson("Unauthorized", 401, requestId);

  const { plantId } = await params;
  const access = await authorizePlantAccess(user.id, plantId);
  if (!access) return errorJson("Plant not found", 404, requestId);

  const db = getDbClient();
  const { data, error } = await db
    .from("plant_images")
    .select(
      "id, plant_id, grow_id, user_id, storage_path, taken_at, source, notes, created_at",
    )
    .eq("plant_id", access.plantId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return errorJson("Query failed", 500, requestId);

  return NextResponse.json(
    {
      plantId: access.plantId,
      images: (data ?? []).map((row) => ({
        id: row.id as string,
        plantId: row.plant_id as string,
        growId: row.grow_id as string,
        userId: row.user_id as string,
        storagePath: row.storage_path as string,
        takenAt: (row.taken_at as string | null) ?? undefined,
        source: row.source as string,
        notes: (row.notes as string | null) ?? undefined,
        createdAt: row.created_at as string,
      })),
      requestId,
    },
    { status: 200, headers: { "x-request-id": requestId } },
  );
}

async function verifyObjectExists(
  // Loose typing because the service-role client is reused and we only need
  // a single Storage API call; the full generated types aren't available here.
  db: ReturnType<typeof getDbClient>,
  path: string,
): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const { data, error } = await db.storage.from(BUCKET).list(dir, {
    limit: 100,
    search: name,
  });
  if (error) return false;
  return (data ?? []).some((entry) => entry.name === name);
}

function errorJson(message: string, status: number, requestId: string) {
  return NextResponse.json(
    { error: message, requestId },
    { status, headers: { "x-request-id": requestId } },
  );
}
