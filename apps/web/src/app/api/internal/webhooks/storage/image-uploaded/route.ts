import { NextRequest } from "next/server";
import { z } from "zod";

import { enqueueAnalysisJobByStoragePath } from "@/lib/server/analysis-jobs";
import { apiError, apiSuccess } from "@/lib/server/api-errors";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";
import { verifyBearerToken } from "@/lib/server/shared-secret";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/internal/webhooks/storage/image-uploaded
//
// Receives a Supabase Database Webhook fired on INSERT into
// `storage.objects` for the `plant-images` bucket and enqueues an
// analysis job for the matching plant_images row. The user-facing
// /api/upload/finalize route creates the plant_images row first, so
// this webhook acts as the auto-analyze trigger that runs after every
// successful upload — no extra click for the grower.
//
// Auth: static bearer token in `Authorization`, keyed by
// SUPABASE_STORAGE_WEBHOOK_SECRET (Supabase Database Webhooks only
// support static custom headers). Optional in dev/preview; required
// in production.
//
// The string `SUPABASE_STORAGE_WEBHOOK_SECRET` must appear in this file
// for the scripts/check-route-security.mjs guardrail.

const PLANT_IMAGES_BUCKET = "plant-images";

const InsertEnvelope = z.object({
  type: z.literal("INSERT"),
  table: z.literal("objects"),
  schema: z.literal("storage"),
  record: z.object({
    name: z.string().min(1),
    bucket_id: z.string().min(1),
  }),
});
const FlatPayload = z.object({
  storage_path: z.string().min(1),
  bucket: z.string().min(1).optional(),
});

type Extracted = { storagePath: string; bucket: string | null };

function extract(payload: unknown): Extracted | null {
  const wrapped = InsertEnvelope.safeParse(payload);
  if (wrapped.success) {
    return {
      storagePath: wrapped.data.record.name,
      bucket: wrapped.data.record.bucket_id,
    };
  }
  const flat = FlatPayload.safeParse(payload);
  if (flat.success) {
    return {
      storagePath: flat.data.storage_path,
      bucket: flat.data.bucket ?? null,
    };
  }
  return null;
}

export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);

  const secret = process.env["SUPABASE_STORAGE_WEBHOOK_SECRET"];
  if (!secret) {
    logServerEvent("error", "storage webhook: secret not configured", {
      requestId,
    });
    return apiError(
      503,
      "CONFIGURATION_ERROR",
      "Webhook receiver not configured",
      requestId,
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!verifyBearerToken(authHeader, secret)) {
    logServerEvent("warn", "storage webhook: bearer rejected", { requestId });
    return apiError(401, "UNAUTHORIZED", "Invalid credentials", requestId);
  }

  let parsedJson: unknown;
  try {
    parsedJson = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body", requestId);
  }

  const extracted = extract(parsedJson);
  if (!extracted) {
    return apiError(
      400,
      "BAD_REQUEST",
      "Payload missing storage path (expected INSERT envelope or { storage_path })",
      requestId,
    );
  }

  // Reject objects from other buckets so a misconfigured webhook can't
  // burn analysis quota on unrelated uploads (avatars, exports, etc.).
  // When the flat payload omits `bucket` we accept it — local-test
  // affordance, matching the auth webhook's flat-payload handling.
  if (extracted.bucket !== null && extracted.bucket !== PLANT_IMAGES_BUCKET) {
    logServerEvent("info", "storage webhook: ignored bucket", {
      requestId,
      bucket: extracted.bucket,
      storagePath: extracted.storagePath,
    });
    return apiSuccess(
      200,
      {
        storage_path: extracted.storagePath,
        enqueued: false,
        reason: "ignored_bucket",
      },
      requestId,
    );
  }

  try {
    const outcome = await enqueueAnalysisJobByStoragePath({
      storagePath: extracted.storagePath,
    });
    if (outcome.kind === "image_not_found") {
      // Raced with /api/upload/finalize, or an out-of-band upload that
      // never finalized. Ack 200 so Supabase doesn't retry forever —
      // the user-triggered analyze flow remains the canonical fallback.
      logServerEvent("warn", "storage webhook: no plant_images row", {
        requestId,
        storagePath: extracted.storagePath,
      });
      return apiSuccess(
        200,
        {
          storage_path: extracted.storagePath,
          enqueued: false,
          reason: "image_not_found",
        },
        requestId,
      );
    }
    if (outcome.kind === "rate_limited") {
      // Per-user analysis ceiling tripped. Ack 200 so Supabase doesn't
      // retry — the user-triggered /api/plants/[plantId]/analyze path is
      // still available if they want this specific image analyzed.
      logServerEvent("warn", "storage webhook: rate-limited", {
        requestId,
        storagePath: extracted.storagePath,
        userId: outcome.userId,
        resetAt: outcome.resetAt,
      });
      return apiSuccess(
        200,
        {
          storage_path: extracted.storagePath,
          enqueued: false,
          reason: "rate_limited",
          reset_at: outcome.resetAt,
        },
        requestId,
      );
    }
    logServerEvent("info", "storage webhook: enqueued analysis", {
      requestId,
      storagePath: extracted.storagePath,
      jobId: outcome.job.id,
      jobStatus: outcome.job.status,
    });
    return apiSuccess(
      200,
      {
        storage_path: extracted.storagePath,
        enqueued: true,
        job_id: outcome.job.id,
        job_status: outcome.job.status,
      },
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "storage webhook: enqueue failed", {
      requestId,
      storagePath: extracted.storagePath,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Failed to enqueue analysis",
      requestId,
    );
  }
}
