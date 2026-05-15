import { NextRequest } from "next/server";
import { z } from "zod";
import { getAnalysisJob } from "@/lib/server/analysis-jobs";
import { apiError, apiSuccess } from "@/lib/server/api-errors";
import { getServerSession } from "@/lib/server/auth";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const JobIdSchema = z.string().uuid();

export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  }

  const { id } = await params;
  const parsedId = JobIdSchema.safeParse(id);
  if (!parsedId.success) {
    return apiError(400, "BAD_REQUEST", "Invalid analysis job id", requestId);
  }

  try {
    const job = await getAnalysisJob(parsedId.data);
    if (!job) {
      return apiError(404, "NOT_FOUND", "Analysis job not found", requestId);
    }
    return apiSuccess(
      200,
      {
        job_id: job.id,
        plant_id: job.plantId,
        image_id: job.imageId,
        status: job.status,
        attempt_count: job.attemptCount,
        max_attempts: job.maxAttempts,
        queued_at: job.queuedAt,
        started_at: job.startedAt,
        finished_at: job.finishedAt,
        error_code: job.errorCode,
        error_message: job.errorMessage,
        result_analysis_id: job.resultAnalysisId,
      },
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "analysis job status fetch failed", {
      requestId,
      jobId: parsedId.data,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Failed to load analysis job",
      requestId,
    );
  }
}
