import { NextRequest } from "next/server";
import { z } from "zod";
import {
  completeAnalysisJob,
  getAnalysisJob,
  isTerminalAnalysisJobStatus,
  type AnalysisJob,
} from "@/lib/server/analysis-jobs";
import { apiError, apiSuccess } from "@/lib/server/api-errors";
import { getServerSession } from "@/lib/server/auth";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const JobIdSchema = z.string().uuid();

// A job is executed by the enqueuing invocation via after() within its
// 60s maxDuration. Anything non-terminal long past that window was
// orphaned by a crashed/timed-out invocation, so reap it on read instead
// of letting the caller poll a "running" job forever.
const STALE_JOB_TIMEOUT_MS = 15 * 60 * 1000;

async function reapIfStale(
  job: AnalysisJob,
  requestId: string,
): Promise<AnalysisJob> {
  if (isTerminalAnalysisJobStatus(job.status)) {
    return job;
  }
  const referenceAt = job.startedAt ?? job.queuedAt;
  const ageMs = Date.now() - Date.parse(referenceAt);
  if (!Number.isFinite(ageMs) || ageMs < STALE_JOB_TIMEOUT_MS) {
    return job;
  }
  const outcome = await completeAnalysisJob({
    jobId: job.id,
    status: "failed",
    errorCode: "stale_timeout",
    errorMessage:
      "Analysis timed out. Try again from the plant page in a few minutes.",
  });
  logServerEvent("warn", "analysis job status: reaped stale job", {
    requestId,
    jobId: job.id,
    previousStatus: job.status,
    ageMs: Math.round(ageMs),
  });
  return outcome.kind === "not_found" ? job : outcome.job;
}

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
    let job = await getAnalysisJob(parsedId.data);
    if (!job) {
      return apiError(404, "NOT_FOUND", "Analysis job not found", requestId);
    }
    job = await reapIfStale(job, requestId);
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
