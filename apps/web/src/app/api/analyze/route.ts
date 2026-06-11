import { NextRequest, after } from "next/server";
import { z } from "zod";
import { executeAnalysisJob } from "@/lib/server/analysis-job-runner";
import {
  ANALYSIS_DAILY_LIMIT_PER_USER,
  ANALYSIS_DAILY_WINDOW_MS,
  enqueueAnalysisJob,
} from "@/lib/server/analysis-jobs";
import { apiError, apiSuccess } from "@/lib/server/api-errors";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";
import { withRouteLogging } from "@/lib/server/route-logging";
import { parseJsonBody } from "@/lib/server/validate";

// The enqueued job is executed in this same invocation via after(), so
// the function must outlive the 202 response long enough for the vision
// call (analysis proxy timeout, default 30s) plus persistence.
export const maxDuration = 60;

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

    // Daily spend cap per account, layered on the burst limit above —
    // each enqueued job triggers one vision call downstream.
    const dailyRate = await rateLimit({
      key: `analyze-daily:${rateLimitKeyFromRequest(request, user?.id ?? null)}`,
      limit: ANALYSIS_DAILY_LIMIT_PER_USER,
      windowMs: ANALYSIS_DAILY_WINDOW_MS,
    });
    if (!dailyRate.ok) {
      return apiError(
        429,
        "RATE_LIMITED",
        "Daily analysis limit reached. Try again tomorrow.",
        requestId,
        { retryAfterSeconds: 3600 },
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
      // Run the job after the response is sent. Idempotent replays of an
      // existing (possibly terminal) job are skipped inside the runner.
      after(() => executeAnalysisJob(job, requestId));
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
