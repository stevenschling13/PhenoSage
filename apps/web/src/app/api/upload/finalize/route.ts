import { NextRequest } from "next/server";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { persistPlantImageUpload } from "@/lib/server/plants";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";
import { apiError, apiSuccess } from "@/lib/server/api-errors";
import { UploadFinalizeRequestSchema, UuidSchema } from "@/lib/server/schemas";
import { parseJsonBody } from "@/lib/server/validate";

const UploadFinalizeRouteSchema = UploadFinalizeRequestSchema.extend({
  plantId: UuidSchema,
});

export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  }

  const user = await getServerUser();
  const rate = await rateLimit({
    key: rateLimitKeyFromRequest(request, user?.id ?? null),
    limit: 10,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return apiError(
      429,
      "RATE_LIMITED",
      "Too many upload finalization requests. Try again shortly.",
      requestId,
      { retryAfterSeconds: 30 },
    );
  }

  const parsed = await parseJsonBody(request, UploadFinalizeRouteSchema);
  if (!parsed.ok) {
    return apiError(
      parsed.status,
      parsed.status === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "UNPROCESSABLE_ENTITY",
      parsed.error,
      requestId,
    );
  }

  try {
    const persisted = await persistPlantImageUpload({
      imageId: parsed.data.imageId,
      plantId: parsed.data.plantId,
      ...(parsed.data.takenAt ? { takenAt: parsed.data.takenAt } : {}),
      ...(parsed.data.source ? { source: parsed.data.source } : {}),
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      storagePath: parsed.data.storagePath,
    });
    if (!persisted) {
      return apiError(
        404,
        "NOT_FOUND",
        "Plant not found or access denied",
        requestId,
      );
    }
    return apiSuccess(201, persisted, requestId);
  } catch (error) {
    logServerEvent("error", "plant image finalize failed", {
      requestId,
      plantId: parsed.data.plantId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Image persistence failed",
      requestId,
    );
  }
}
