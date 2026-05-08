import { NextRequest, NextResponse } from "next/server";
import {
  allowedImageMimeSchema,
  uploadsSignRequestSchema,
} from "@phenosage/shared";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { preparePlantImageUpload } from "@/lib/server/plants";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";
import { parseJson } from "@/lib/server/validate";

// POST /api/uploads/sign
// Returns a short-lived Supabase Storage signed upload URL.
// The browser uploads directly to Supabase; the signed URL is generated here
// on the server so the service role key is never exposed.
export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 }),
      requestId,
    );
  }

  const user = await getServerUser();
  const rate = rateLimit({
    key: `upload-sign:${rateLimitKeyFromRequest(request, user?.id ?? null)}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return attachRequestId(
      NextResponse.json(
        {
          error: "Too many upload preparations. Try again shortly.",
          requestId,
        },
        { status: 429 },
      ),
      requestId,
    );
  }

  const parsed = await parseJson(request, uploadsSignRequestSchema, {
    requestId,
  });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Strict MIME whitelist — kept as a separate check so 415 stays distinct
  // from a 400 (shape) error.
  if (!allowedImageMimeSchema.safeParse(body.contentType).success) {
    return attachRequestId(
      NextResponse.json(
        { error: "Unsupported content type", requestId },
        { status: 415 },
      ),
      requestId,
    );
  }

  try {
    const prepared = await preparePlantImageUpload({
      plantId: body.plantId,
      fileName: body.fileName,
      contentType: body.contentType,
      requestId,
    });

    if (!prepared) {
      return attachRequestId(
        NextResponse.json(
          { error: "Plant not found or access denied", requestId },
          { status: 404 },
        ),
        requestId,
      );
    }

    return attachRequestId(
      NextResponse.json({ ...prepared, requestId }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "upload signing failed", {
      requestId,
      plantId: body.plantId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return attachRequestId(
      NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Upload signing failed",
          requestId,
        },
        { status: 500 },
      ),
      requestId,
    );
  }
}
