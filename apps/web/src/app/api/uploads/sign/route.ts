import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/server/auth";
import { getStorageClient } from "@/lib/server/storage";
import { authorizePlantAccess } from "@/lib/server/authorization";
import { correlationIdFromRequest, createLogger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PLANT_IMAGES_BUCKET = "plant-images";
const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};
const MAX_FILENAME_LEN = 240;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/uploads/sign
 *
 * Body: { plantId: uuid, contentType: string, fileName?: string }
 *
 * Returns a short-lived Supabase Storage signed upload URL scoped to a
 * deterministic path under the private `plant-images` bucket. The browser uses
 * the returned URL/token to upload directly to Supabase; the service role key
 * never leaves the server.
 */
export async function POST(request: NextRequest) {
  const requestId = correlationIdFromRequest(request);
  const log = createLogger({ route: "api.uploads.sign", requestId });

  const user = await getServerUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", requestId },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400, requestId);
  }

  const parsed = parseBody(body);
  if (!parsed.ok) return jsonError(parsed.error, 400, requestId);

  const { plantId, contentType, fileName } = parsed.value;

  if (!ALLOWED_TYPES.has(contentType)) {
    return jsonError("Unsupported content type", 415, requestId);
  }

  const access = await authorizePlantAccess(user.id, plantId);
  if (!access) {
    return jsonError("Plant not found", 404, requestId);
  }

  const safeName = sanitizeFileName(fileName, contentType);
  const storagePath = `${access.growId}/${plantId}/${Date.now()}-${crypto
    .randomUUID()
    .slice(0, 8)}-${safeName}`;

  const storage = getStorageClient();
  const { data, error } = await storage
    .from(PLANT_IMAGES_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    log.error("createSignedUploadUrl failed", {
      plantId,
      error: error?.message,
    });
    return jsonError("Could not create upload URL", 502, requestId);
  }

  log.info("signed upload issued", {
    plantId,
    userId: user.id,
    bucket: PLANT_IMAGES_BUCKET,
  });

  return NextResponse.json(
    {
      bucket: PLANT_IMAGES_BUCKET,
      storagePath,
      signedUrl: data.signedUrl,
      token: data.token,
      contentType,
      requestId,
    },
    { status: 200, headers: { "x-request-id": requestId } },
  );
}

type ParsedBody = {
  plantId: string;
  contentType: string;
  fileName: string | undefined;
};

function parseBody(
  value: unknown,
): { ok: true; value: ParsedBody } | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "body must be an object" };
  }
  const v = value as Record<string, unknown>;

  const plantId = v["plantId"];
  if (typeof plantId !== "string" || !UUID_RE.test(plantId)) {
    return { ok: false, error: "plantId must be a uuid" };
  }
  const contentType = v["contentType"];
  if (typeof contentType !== "string" || contentType.length > 128) {
    return { ok: false, error: "contentType is required" };
  }
  const fileName = v["fileName"];
  if (
    fileName !== undefined &&
    (typeof fileName !== "string" || fileName.length > MAX_FILENAME_LEN)
  ) {
    return { ok: false, error: "fileName is invalid" };
  }
  return {
    ok: true,
    value: {
      plantId,
      contentType,
      fileName: typeof fileName === "string" ? fileName : undefined,
    },
  };
}

function sanitizeFileName(
  fileName: string | undefined,
  contentType: string,
): string {
  const ext = EXT_BY_TYPE[contentType] ?? "bin";
  if (!fileName) return `upload.${ext}`;
  const base = fileName.split(/[\\/]/).pop() ?? "upload";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  if (!cleaned) return `upload.${ext}`;
  return cleaned.includes(".") ? cleaned : `${cleaned}.${ext}`;
}

function jsonError(
  message: string,
  status: number,
  requestId: string,
): NextResponse {
  return NextResponse.json(
    { error: message, requestId },
    { status, headers: { "x-request-id": requestId } },
  );
}
