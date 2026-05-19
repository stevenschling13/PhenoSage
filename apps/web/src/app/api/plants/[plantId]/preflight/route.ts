import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/server/api-errors";
import { preflightImage } from "@/lib/server/analysis-proxy";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { getDbClient } from "@/lib/server/db";
import { getAuthorizedPlantContext } from "@/lib/server/plant-access";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";
import { UpstreamError } from "@/lib/server/resilience";
import { traceContextFromRequest } from "@/lib/server/trace-context";
import { parseJsonBody } from "@/lib/server/validate";

const PlantIdSchema = z.string().uuid();
const PreflightBodySchema = z.object({
  imageId: z.string().uuid(),
});

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

/**
 * POST /api/plants/[plantId]/preflight
 *
 * Runs the AI Capture Coach quality check on an already-uploaded image.
 * Returns `{ ok, reason, hint }` so the upload UI can warn the user
 * *before* an expensive vision call is triggered.
 *
 *   - 401 / 404 / 422: standard auth + RLS + body-validation envelope
 *   - 404 also fires when the image id is unknown or doesn't belong to
 *     this plant (image-existence is not disclosed across plants)
 *   - 429 when the per-user rate budget is exhausted (preflight is far
 *     cheaper than analyze, so we allow a generous 30/min)
 *   - 502/503 on analysis-service failure (the UI should treat as
 *     "preflight unavailable" and let the user proceed at their own
 *     risk — preflight is advisory, not a hard gate)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  }

  const { plantId } = await params;
  const parsedId = PlantIdSchema.safeParse(plantId);
  if (!parsedId.success) {
    return apiError(400, "BAD_REQUEST", "Invalid plant id", requestId);
  }

  const user = await getServerUser();
  // Preflight is PIL-only on the server (no vision call) — we still cap
  // to defang a runaway client loop, but the budget can be generous.
  const rate = await rateLimit({
    key: `preflight:${rateLimitKeyFromRequest(request, user?.id ?? null)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return apiError(
      429,
      "RATE_LIMITED",
      "Too many preflight requests. Try again shortly.",
      requestId,
      { retryAfterSeconds: 15 },
    );
  }

  const parsedBody = await parseJsonBody(request, PreflightBodySchema);
  if (!parsedBody.ok) {
    return apiError(
      parsedBody.status,
      parsedBody.status === 415
        ? "UNSUPPORTED_MEDIA_TYPE"
        : "UNPROCESSABLE_ENTITY",
      parsedBody.error,
      requestId,
    );
  }

  const context = await getAuthorizedPlantContext(parsedId.data);
  if (!context) {
    return apiError(
      404,
      "NOT_FOUND",
      "Plant not found or access denied",
      requestId,
    );
  }

  const db = getDbClient();
  const { data: imageRow, error: imageError } = await db
    .from("plant_images")
    .select("id, storage_path")
    .eq("id", parsedBody.data.imageId)
    .eq("plant_id", context.plantId)
    .maybeSingle();

  if (imageError) {
    logServerEvent("error", "preflight image lookup failed", {
      requestId,
      plantId: context.plantId,
      imageId: parsedBody.data.imageId,
      error: imageError.message,
    });
    return apiError(500, "INTERNAL_ERROR", "Failed to load image", requestId);
  }
  if (!imageRow) {
    // Image id is unknown for THIS plant — return 404 without disclosing
    // whether the id exists under a different plant.
    return apiError(404, "NOT_FOUND", "Image not found", requestId);
  }

  const row = imageRow as { id: string; storage_path: string };
  const traceContext = traceContextFromRequest(request);

  try {
    const result = await preflightImage({
      plantId: context.plantId,
      imageId: row.id,
      storagePath: row.storage_path,
      requestId,
      traceparent: traceContext.traceparent,
    });
    return apiSuccess(200, result, requestId);
  } catch (error) {
    if (error instanceof UpstreamError) {
      logServerEvent("warn", "preflight upstream failed", {
        requestId,
        plantId: context.plantId,
        code: error.code,
        status: error.status ?? null,
      });
      const status =
        error.code === "UPSTREAM_RATE_LIMITED"
          ? 429
          : error.code === "UPSTREAM_UNAVAILABLE"
            ? 503
            : 502;
      const code =
        error.code === "UPSTREAM_RATE_LIMITED"
          ? "UPSTREAM_RATE_LIMITED"
          : "UPSTREAM_UNAVAILABLE";
      return apiError(
        status,
        code,
        "Preflight service is temporarily unavailable.",
        requestId,
        error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {},
      );
    }
    logServerEvent("error", "preflight unexpected failure", {
      requestId,
      plantId: context.plantId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(500, "INTERNAL_ERROR", "Preflight failed.", requestId);
  }
}
