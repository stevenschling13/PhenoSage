import { NextRequest } from "next/server";
import { z } from "zod";
import { enqueueAnalysisJob } from "@/lib/server/analysis-jobs";
import { apiError, apiSuccess } from "@/lib/server/api-errors";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";
import { withRouteLogging } from "@/lib/server/route-logging";
import { parseJsonBody } from "@/lib/server/validate";

const AnalyzeJobRequestSchema = z.object({
  plant_id: z.string().uuid(),
  image_id: z.string().uuid(),
  idempotency_key: z.string().min(8).max(128).optional(),
});

export const POST = withRouteLogging(
  "/api/analyze",
  async (request: NextRequest) => {
    const requestId = getOrCreateRequestId(request);
    const session = await getServerSession();
    if (!session) {
      return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
    }

    const user = await getServerUser();
    const rate = await rateLimit({
      key: `analyze:${rateLimitKeyFromRequest(request, user?.id ?? null)}`,
      limit: 5,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      return apiError(
        429,
        "RATE_LIMITED",
        "Too many analysis requests. Try again shortly.",
        requestId,
        { retryAfterSeconds: 30 },
      );
    }

    const parsed = await parseJsonBody(request, AnalyzeJobRequestSchema);
    if (!parsed.ok) {
      return apiError(
        parsed.status,
        parsed.status === 415
          ? "UNSUPPORTED_MEDIA_TYPE"
          : "UNPROCESSABLE_ENTITY",
        parsed.error,
        requestId,
      );
    }

    try {
      const job = await enqueueAnalysisJob({
        plantId: parsed.data.plant_id,
        imageId: parsed.data.image_id,
        ...(parsed.data.idempotency_key
          ? { idempotencyKey: parsed.data.idempotency_key }
          : {}),
      });
      if (!job) {
        return apiError(
          404,
          "NOT_FOUND",
          "Plant image not found or access denied",
          requestId,
        );
      }
      return apiSuccess(
        202,
        {
          job_id: job.id,
          status: job.status,
          plant_id: job.plantId,
          image_id: job.imageId,
        },
        requestId,
      );
    } catch (error) {
      logServerEvent("error", "analysis job enqueue failed", {
        requestId,
        error: error instanceof Error ? error.message : "unknown_error",
      });
      return apiError(
        500,
        "INTERNAL_ERROR",
        "Failed to enqueue analysis job",
        requestId,
      );
    }
  },
);
