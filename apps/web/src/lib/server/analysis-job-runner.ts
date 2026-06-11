import "server-only";

import {
  claimQueuedAnalysisJob,
  completeAnalysisJob,
  type AnalysisJob,
} from "./analysis-jobs";
import { getServiceRolePlantContext } from "./plant-access";
import { runAndPersistPlantAnalysisForContext } from "./plants";
import { logServerEvent } from "./request-id";

/**
 * Execute one queued `analysis_jobs` row end-to-end: claim it
 * (queued → running), run the vision analysis + persistence pipeline,
 * and record the terminal status. This is the queue's only consumer —
 * the enqueue routes schedule it via `after()` so the 202 response
 * returns immediately while the work finishes in the background of the
 * same invocation.
 *
 * Error messages written to the job row are read back by
 * `/api/analysis_jobs/[id]`, so they must stay user-safe: stable copy
 * only, never raw provider/Supabase error text (that goes to the server
 * log instead).
 */
export async function executeAnalysisJob(
  job: AnalysisJob,
  requestId: string,
): Promise<void> {
  if (job.status !== "queued") {
    return;
  }

  let claimed: AnalysisJob | null = null;
  try {
    claimed = await claimQueuedAnalysisJob(job);
  } catch (error) {
    logServerEvent("error", "analysis job runner: claim failed", {
      requestId,
      jobId: job.id,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return;
  }
  if (!claimed) {
    logServerEvent("info", "analysis job runner: already claimed", {
      requestId,
      jobId: job.id,
    });
    return;
  }

  try {
    const context = await getServiceRolePlantContext(
      claimed.plantId,
      claimed.requestedBy,
    );
    if (!context) {
      await completeAnalysisJob({
        jobId: claimed.id,
        status: "failed",
        errorCode: "plant_not_found",
        errorMessage: "The plant for this analysis no longer exists.",
      });
      return;
    }

    const result = await runAndPersistPlantAnalysisForContext(context, {
      imageId: claimed.imageId,
      requestId,
    });
    if (!result.analysis) {
      await completeAnalysisJob({
        jobId: claimed.id,
        status: "failed",
        errorCode: "image_not_found",
        errorMessage: "The image for this analysis no longer exists.",
      });
      return;
    }

    await completeAnalysisJob({
      jobId: claimed.id,
      status: "succeeded",
      resultAnalysisId: result.analysisId,
    });
    logServerEvent("info", "analysis job runner: job succeeded", {
      requestId,
      jobId: claimed.id,
      plantId: claimed.plantId,
      imageId: claimed.imageId,
      analysisId: result.analysisId,
      isFallback: result.analysis.isFallback ?? false,
    });
  } catch (error) {
    logServerEvent("error", "analysis job runner: job failed", {
      requestId,
      jobId: claimed.id,
      plantId: claimed.plantId,
      imageId: claimed.imageId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    try {
      await completeAnalysisJob({
        jobId: claimed.id,
        status: "failed",
        errorCode: "analysis_error",
        errorMessage:
          "Analysis failed. Try again from the plant page in a few minutes.",
      });
    } catch (completeError) {
      logServerEvent("error", "analysis job runner: failure record failed", {
        requestId,
        jobId: claimed.id,
        error:
          completeError instanceof Error
            ? completeError.message
            : "unknown_error",
      });
    }
  }
}
