import { UuidSchema } from "@phenosage/shared";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server/auth";
import { apiError } from "@/lib/server/api-errors";
import { getAnalysisJobForPlant } from "@/lib/server/plants";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";

interface RouteParams {
  params: Promise<{ plantId: string; jobId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);

  const { plantId, jobId } = await params;
  if (
    !UuidSchema.safeParse(plantId).success ||
    !UuidSchema.safeParse(jobId).success
  ) {
    return apiError(
      422,
      "UNPROCESSABLE_ENTITY",
      "Invalid plantId or jobId",
      requestId,
    );
  }

  try {
    const result = await getAnalysisJobForPlant({ plantId, jobId });
    if (!result)
      return apiError(
        404,
        "NOT_FOUND",
        "Plant not found or access denied",
        requestId,
      );
    if (!result.job)
      return apiError(404, "NOT_FOUND", "Analysis job not found", requestId);

    return attachRequestId(
      NextResponse.json({
        analysisJob: {
          id: result.job.id,
          plantId: result.job.plant_id,
          imageId: result.job.image_id,
          status: result.job.status,
          attemptCount: result.job.attempt_count,
          maxAttempts: result.job.max_attempts,
          queuedAt: result.job.queued_at,
          startedAt: result.job.started_at,
          finishedAt: result.job.finished_at,
          errorCode: result.job.error_code,
          errorMessage: result.job.error_message,
          resultAnalysisId: result.job.result_analysis_id,
        },
        requestId,
      }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "analysis job lookup failed", {
      requestId,
      plantId,
      jobId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Analysis job lookup failed",
      requestId,
    );
  }
}
