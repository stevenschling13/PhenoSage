import { NextRequest } from "next/server";
import { z } from "zod";

import { completeAnalysisJob } from "@/lib/server/analysis-jobs";
import { apiError, apiSuccess } from "@/lib/server/api-errors";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";
import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  verifyWebhookSignature,
} from "@/lib/server/webhook-signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/internal/webhooks/analysis-complete
//
// Receives a fire-and-forget callback from the analysis service when an
// async analysis_jobs row reaches a terminal status. The browser never
// calls this route. Auth is HMAC-SHA256 over the raw request body and the
// timestamp header, keyed by ANALYSIS_WEBHOOK_SECRET (shared with the
// Python service). Idempotent: a job already in a terminal status returns
// 200 with the existing row, so the sender can retry on transport errors
// without risk of overwriting a prior result.
//
// String `ANALYSIS_WEBHOOK_SECRET` must appear in this file for the
// scripts/check-route-security.mjs guardrail (internal routes must
// verify a shared secret).

const PayloadSchema = z
  .object({
    jobId: z.string().uuid(),
    status: z.enum(["succeeded", "failed"]),
    resultAnalysisId: z.string().uuid().nullish(),
    errorCode: z.string().min(1).max(64).nullish(),
    errorMessage: z.string().min(1).max(2000).nullish(),
    finishedAt: z.string().datetime({ offset: true }).optional(),
    attempt: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.status === "succeeded" && !val.resultAnalysisId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resultAnalysisId"],
        message: "resultAnalysisId is required when status is 'succeeded'",
      });
    }
    if (val.status === "failed" && !val.errorCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorCode"],
        message: "errorCode is required when status is 'failed'",
      });
    }
  });

export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);

  const secret = process.env["ANALYSIS_WEBHOOK_SECRET"];
  if (!secret) {
    logServerEvent("error", "analysis webhook: secret not configured", {
      requestId,
    });
    return apiError(
      503,
      "CONFIGURATION_ERROR",
      "Webhook receiver not configured",
      requestId,
    );
  }

  // Read the raw body BEFORE parsing JSON — the HMAC is computed over the
  // exact bytes the sender signed, so any intermediate re-serialization
  // would break verification (key order, whitespace, number formatting).
  const rawBody = await request.text();

  const verdict = verifyWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get(WEBHOOK_SIGNATURE_HEADER),
    timestampHeader: request.headers.get(WEBHOOK_TIMESTAMP_HEADER),
    secret,
  });
  if (!verdict.ok) {
    logServerEvent("warn", "analysis webhook: signature rejected", {
      requestId,
      reason: verdict.reason,
    });
    return apiError(401, "UNAUTHORIZED", "Invalid signature", requestId);
  }

  let parsedJson: unknown;
  try {
    parsedJson = rawBody.length === 0 ? null : JSON.parse(rawBody);
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body", requestId);
  }

  const parsed = PayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return apiError(
      400,
      "BAD_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid payload",
      requestId,
    );
  }

  const payload = parsed.data;

  try {
    const completeInput: Parameters<typeof completeAnalysisJob>[0] = {
      jobId: payload.jobId,
      status: payload.status,
      resultAnalysisId: payload.resultAnalysisId ?? null,
      errorCode: payload.errorCode ?? null,
      errorMessage: payload.errorMessage ?? null,
    };
    if (payload.finishedAt) completeInput.finishedAt = payload.finishedAt;
    if (typeof payload.attempt === "number") {
      completeInput.attemptCount = payload.attempt;
    }
    const outcome = await completeAnalysisJob(completeInput);

    if (outcome.kind === "not_found") {
      return apiError(404, "NOT_FOUND", "Analysis job not found", requestId);
    }

    const duplicate = outcome.kind === "already_terminal";
    if (duplicate) {
      logServerEvent("info", "analysis webhook: duplicate terminal callback", {
        requestId,
        jobId: payload.jobId,
        status: outcome.job.status,
      });
    } else {
      logServerEvent("info", "analysis webhook: job updated", {
        requestId,
        jobId: payload.jobId,
        status: outcome.job.status,
      });
    }

    return apiSuccess(
      200,
      {
        job_id: outcome.job.id,
        status: outcome.job.status,
        finished_at: outcome.job.finishedAt,
        result_analysis_id: outcome.job.resultAnalysisId,
        error_code: outcome.job.errorCode,
        error_message: outcome.job.errorMessage,
        duplicate,
      },
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "analysis webhook: update failed", {
      requestId,
      jobId: payload.jobId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Failed to update analysis job",
      requestId,
    );
  }
}
