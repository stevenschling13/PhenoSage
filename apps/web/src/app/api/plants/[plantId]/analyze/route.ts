import { NextRequest, after } from "next/server";
import { executeAnalysisJob } from "@/lib/server/analysis-job-runner";
import { enqueueAnalysisJob } from "@/lib/server/analysis-jobs";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { apiError, apiSuccess } from "@/lib/server/api-errors";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";
import { AnalyzeRequestSchema } from "@/lib/server/schemas";
import { parseJsonBody } from "@/lib/server/validate";

// The enqueued job is executed in this same invocation via after(), so
// the function must outlive the 202 response long enough for the vision
// call (analysis proxy timeout, default 30s) plus persistence.
export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  }

  const user = await getServerUser();
  const rate = await rateLimit({
    key: rateLimitKeyFromRequest(request, user?.id ?? null),
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

  const { plantId } = await params;
  const parsed = await parseJsonBody(request, AnalyzeRequestSchema);
  if (!parsed.ok) {
    return apiError(
      parsed.status,
      parsed.status === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "UNPROCESSABLE_ENTITY",
      parsed.error,
      requestId,
    );
  }

  try {
    const job = await enqueueAnalysisJob({
      plantId,
      imageId: parsed.data.imageId,
      ...(parsed.data.idempotencyKey
        ? { idempotencyKey: parsed.data.idempotencyKey }
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
    // Log the underlying cause for operators but never echo the raw exception
    // text to the browser — it can include "fetch failed", upstream URLs, env
    // variable names, or stack-trace fragments.
    logServerEvent("error", "plant analysis failed", {
      requestId,
      plantId,
      imageId: parsed.data.imageId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Plant analysis failed. Please try again.",
      requestId,
    );
  }
}
