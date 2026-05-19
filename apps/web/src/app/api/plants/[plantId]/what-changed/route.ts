import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/server/api-errors";
import {
  compareImages,
  type AnalyzeGrowContext,
} from "@/lib/server/analysis-proxy";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { getDbClient } from "@/lib/server/db";
import { getAuthorizedPlantContext } from "@/lib/server/plant-access";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";
import { UpstreamError } from "@/lib/server/resilience";
import { traceContextFromRequest } from "@/lib/server/trace-context";

const PlantIdSchema = z.string().uuid();

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

function daysSinceStart(startDate: string | null): number | undefined {
  if (!startDate) return undefined;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return undefined;
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86_400_000));
}

/**
 * POST /api/plants/[plantId]/what-changed
 *
 * Returns a structured "what changed" comparison between the plant's two
 * most recent images. Pulls one extra dependency hop (vision model with two
 * images) so it's gated more tightly than analyze:
 *
 *   - 401 when unauthenticated
 *   - 404 when the plant doesn't exist or the caller doesn't own / collaborate
 *     on the grow (RLS)
 *   - 422 when the plant has fewer than two stored images (nothing to compare)
 *   - 429 when the per-user rate budget is exhausted
 *   - 502/503 when the analysis service is unhealthy
 *
 * On success the body is `{ data: ImageComparisonResult }`. The result is
 * NOT persisted — every call re-runs the vision call. Client should cache
 * locally per `(imageIdCurrent, imageIdPrevious)` pair.
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
  // Vision-on-vision calls are dramatically more expensive than analyze; cap
  // tighter (6/min per user) so a stuck UI loop can't run up the bill.
  const rate = await rateLimit({
    key: `what-changed:${rateLimitKeyFromRequest(request, user?.id ?? null)}`,
    limit: 6,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return apiError(
      429,
      "RATE_LIMITED",
      "Too many comparison requests. Try again shortly.",
      requestId,
      { retryAfterSeconds: 30 },
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
  const { data: imageRows, error: imageError } = await db
    .from("plant_images")
    .select("id, storage_path, taken_at, created_at")
    .eq("plant_id", context.plantId)
    .order("created_at", { ascending: false })
    .limit(2);

  if (imageError) {
    logServerEvent("error", "what-changed image lookup failed", {
      requestId,
      plantId: context.plantId,
      error: imageError.message,
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Failed to load plant images",
      requestId,
    );
  }

  type ImageRow = {
    id: string;
    storage_path: string;
    taken_at: string | null;
    created_at: string;
  };
  const images = (imageRows ?? []) as ImageRow[];
  if (images.length < 2) {
    return apiError(
      422,
      "UNPROCESSABLE_ENTITY",
      "Need at least two captures to compare.",
      requestId,
    );
  }

  const [current, previous] = images;

  const growContext: AnalyzeGrowContext = { growId: context.growId };
  if (context.strain) growContext.strain = context.strain;
  if (context.growStage) growContext.stage = context.growStage;
  if (context.medium) growContext.medium = context.medium;
  if (context.lightType) growContext.lightType = context.lightType;
  const days = daysSinceStart(context.startDate);
  if (days !== undefined) growContext.daysSinceStart = days;
  if (context.notes) growContext.notes = context.notes;

  const traceContext = traceContextFromRequest(request);

  try {
    const result = await compareImages({
      plantId: context.plantId,
      imageIdCurrent: current!.id,
      storagePathCurrent: current!.storage_path,
      imageIdPrevious: previous!.id,
      storagePathPrevious: previous!.storage_path,
      growContext,
      requestId,
      traceparent: traceContext.traceparent,
    });
    return apiSuccess(200, result, requestId);
  } catch (error) {
    if (error instanceof UpstreamError) {
      logServerEvent("warn", "what-changed upstream failed", {
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
          : error.code === "UPSTREAM_UNAVAILABLE"
            ? "UPSTREAM_UNAVAILABLE"
            : "UPSTREAM_UNAVAILABLE";
      return apiError(
        status,
        code,
        "Comparison service is temporarily unavailable.",
        requestId,
        error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {},
      );
    }
    logServerEvent("error", "what-changed unexpected failure", {
      requestId,
      plantId: context.plantId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Failed to generate comparison.",
      requestId,
    );
  }
}
