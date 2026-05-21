import "server-only";
import type { AnalysisJobStatus } from "@phenosage/shared";
import { createSupabaseServerClient } from "./auth";
import { getDbClient } from "./db";
import { getAuthorizedPlantContext } from "./plant-access";

type AnalysisJobRow = {
  id: string;
  plant_id: string;
  image_id: string;
  grow_id: string;
  requested_by: string;
  status: AnalysisJobStatus;
  attempt_count: number;
  max_attempts: number;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
  result_analysis_id: string | null;
};

export type AnalysisJob = {
  id: string;
  plantId: string;
  imageId: string;
  growId: string;
  requestedBy: string;
  status: AnalysisJobStatus;
  attemptCount: number;
  maxAttempts: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  resultAnalysisId: string | null;
};

function mapJob(row: AnalysisJobRow): AnalysisJob {
  return {
    id: row.id,
    plantId: row.plant_id,
    imageId: row.image_id,
    growId: row.grow_id,
    requestedBy: row.requested_by,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    resultAnalysisId: row.result_analysis_id,
  };
}

export async function enqueueAnalysisJob(params: {
  plantId: string;
  imageId: string;
  idempotencyKey?: string;
}): Promise<AnalysisJob | null> {
  const context = await getAuthorizedPlantContext(params.plantId);
  if (!context) {
    return null;
  }

  const db = getDbClient();
  const { data: image, error: imageError } = await db
    .from("plant_images")
    .select("id")
    .eq("id", params.imageId)
    .eq("plant_id", context.plantId)
    .maybeSingle();

  if (imageError) {
    throw new Error(`Failed to validate analysis image: ${imageError.message}`);
  }
  if (!image) {
    return null;
  }

  const { data, error } = await db.rpc("enqueue_analysis_job", {
    p_plant_id: context.plantId,
    p_image_id: params.imageId,
    p_grow_id: context.growId,
    p_requested_by: context.userId,
    p_idempotency_key: params.idempotencyKey ?? null,
    p_max_attempts: 3,
  });

  if (error) {
    throw new Error(`Failed to enqueue analysis job: ${error.message}`);
  }

  return mapJob(data as AnalysisJobRow);
}

export async function getAnalysisJob(
  jobId: string,
): Promise<AnalysisJob | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("analysis_jobs")
    .select(
      "id,plant_id,image_id,grow_id,requested_by,status,attempt_count,max_attempts,queued_at,started_at,finished_at,error_code,error_message,result_analysis_id",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load analysis job: ${error.message}`);
  }
  return data ? mapJob(data as AnalysisJobRow) : null;
}

const TERMINAL_STATUSES: ReadonlySet<AnalysisJobStatus> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

export type CompleteAnalysisJobOutcome =
  | { kind: "not_found" }
  | { kind: "already_terminal"; job: AnalysisJob }
  | { kind: "updated"; job: AnalysisJob };

interface CompleteAnalysisJobInput {
  jobId: string;
  status: "succeeded" | "failed";
  resultAnalysisId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  finishedAt?: string;
  attemptCount?: number;
}

/**
 * Apply a terminal status to an analysis job using the service-role
 * client. Idempotent: if the job is already in a terminal status the
 * current row is returned unchanged so the caller can respond 200 to
 * webhook retries without overwriting prior results.
 */
export async function completeAnalysisJob(
  input: CompleteAnalysisJobInput,
): Promise<CompleteAnalysisJobOutcome> {
  const db = getDbClient();
  const { data: existing, error: loadError } = await db
    .from("analysis_jobs")
    .select(
      "id,plant_id,image_id,grow_id,requested_by,status,attempt_count,max_attempts,queued_at,started_at,finished_at,error_code,error_message,result_analysis_id",
    )
    .eq("id", input.jobId)
    .maybeSingle();
  if (loadError) {
    throw new Error(`Failed to load analysis job: ${loadError.message}`);
  }
  if (!existing) return { kind: "not_found" };
  const current = mapJob(existing as AnalysisJobRow);
  if (TERMINAL_STATUSES.has(current.status)) {
    return { kind: "already_terminal", job: current };
  }

  const finishedAt = input.finishedAt ?? new Date().toISOString();
  const patch: Partial<AnalysisJobRow> = {
    status: input.status,
    finished_at: finishedAt,
    error_code: input.status === "failed" ? (input.errorCode ?? null) : null,
    error_message:
      input.status === "failed" ? (input.errorMessage ?? null) : null,
    result_analysis_id:
      input.status === "succeeded" ? (input.resultAnalysisId ?? null) : null,
  };
  if (typeof input.attemptCount === "number") {
    patch.attempt_count = input.attemptCount;
  }

  const { data: updated, error: updateError } = await db
    .from("analysis_jobs")
    .update(patch)
    .eq("id", input.jobId)
    .select(
      "id,plant_id,image_id,grow_id,requested_by,status,attempt_count,max_attempts,queued_at,started_at,finished_at,error_code,error_message,result_analysis_id",
    )
    .maybeSingle();
  if (updateError) {
    throw new Error(`Failed to update analysis job: ${updateError.message}`);
  }
  if (!updated) return { kind: "not_found" };
  return { kind: "updated", job: mapJob(updated as AnalysisJobRow) };
}
