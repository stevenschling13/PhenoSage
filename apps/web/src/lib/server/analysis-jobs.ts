import "server-only";
import type { AnalysisJobStatus } from "@phenosage/shared";
import { createSupabaseServerClient } from "./auth";
import { getDbClient } from "./db";
import { getAuthorizedPlantContext } from "./plant-access";
import { rateLimit } from "./rate-limit";

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

export type EnqueueByStoragePathOutcome =
  | { kind: "image_not_found"; storagePath: string }
  | { kind: "rate_limited"; userId: string; resetAt: number }
  | { kind: "enqueued"; job: AnalysisJob };

// Per-user ceiling on auto-analyzed uploads. Sized so a grower with a
// frantic morning photo session can still get every image analyzed, but
// a runaway script (someone scripting 500 uploads) hits the brake before
// burning through OpenAI quota. Each analysis job triggers one vision
// call downstream. Bump this if real users hit the cap in production
// — see logs for `storage webhook: rate-limited` warnings.
const ANALYSIS_ENQUEUE_LIMIT_PER_HOUR = 20;
const ANALYSIS_ENQUEUE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Enqueue an analysis job for an image identified by its storage path,
 * with no caller session. Used by the storage webhook receiver: the
 * plant_images row was already created (and ownership-checked) by the
 * authenticated `/api/upload/finalize` flow, so we trust the row's
 * plant_id / grow_id / user_id rather than re-checking auth.uid().
 *
 * Idempotent via `idempotency_key = storage-webhook:<imageId>`. Repeated
 * webhook deliveries for the same upload return the same job row.
 *
 * Rate-limited per `plant_images.user_id` at
 * `ANALYSIS_ENQUEUE_LIMIT_PER_HOUR` (20/hr default). When the cap is
 * hit, returns `{ kind: "rate_limited" }` — the storage webhook
 * acknowledges the delivery with 200 so Supabase doesn't retry, and a
 * subsequent user-triggered `/api/plants/[plantId]/analyze` (which has
 * its own session-scoped path) still works.
 */
export async function enqueueAnalysisJobByStoragePath(params: {
  storagePath: string;
}): Promise<EnqueueByStoragePathOutcome> {
  const db = getDbClient();
  const { data: image, error: imageError } = await db
    .from("plant_images")
    .select("id, plant_id, grow_id, user_id")
    .eq("storage_path", params.storagePath)
    .maybeSingle();
  if (imageError) {
    throw new Error(`Failed to look up plant image: ${imageError.message}`);
  }
  if (!image) {
    return { kind: "image_not_found", storagePath: params.storagePath };
  }

  // Per-user ceiling on auto-enqueued analyses. We rate-limit BEFORE the
  // RPC so a runaway upload script can't both burn vision quota AND fill
  // analysis_jobs with rows that will never be drained. The limiter
  // fails open on a Redis outage (see rateLimit() docstring) — that's
  // the right tradeoff because the failure mode of fail-closed here is
  // "growers' uploads silently stop being analyzed", which is worse
  // than the cost overrun the limiter is defending against.
  const rate = await rateLimit({
    key: `analysis-enqueue:${image.user_id}`,
    limit: ANALYSIS_ENQUEUE_LIMIT_PER_HOUR,
    windowMs: ANALYSIS_ENQUEUE_WINDOW_MS,
  });
  if (!rate.ok) {
    return {
      kind: "rate_limited",
      userId: image.user_id,
      resetAt: rate.resetAt,
    };
  }

  const { data, error } = await db.rpc("enqueue_analysis_job", {
    p_plant_id: image.plant_id,
    p_image_id: image.id,
    p_grow_id: image.grow_id,
    p_requested_by: image.user_id,
    p_idempotency_key: `storage-webhook:${image.id}`,
    p_max_attempts: 3,
  });
  if (error) {
    throw new Error(`Failed to enqueue analysis job: ${error.message}`);
  }

  return { kind: "enqueued", job: mapJob(data as AnalysisJobRow) };
}

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
