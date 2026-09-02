import { NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/server/api-errors";
import { seedDefaultGrowForUser } from "@/lib/server/onboarding";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";
import { verifyBearerToken } from "@/lib/server/shared-secret";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/internal/webhooks/auth/user-created
//
// Receives a Supabase Database Webhook fired on INSERT into `auth.users`
// and seeds a default `grows` row so the dashboard doesn't open in an
// empty state. Idempotent: a duplicate delivery for a user who already
// owns a grow is acknowledged with 200 and no insert.
//
// Auth: a static bearer token in the `Authorization` header keyed by
// SUPABASE_AUTH_WEBHOOK_SECRET. Supabase Database Webhooks only allow
// static custom headers, so HMAC-per-request (as used by the analysis
// service) isn't an option here — the secret rotates instead.
//
// The string `SUPABASE_AUTH_WEBHOOK_SECRET` must appear in this file for
// the scripts/check-route-security.mjs guardrail (internal routes must
// reference a known shared secret).

// Supabase Database Webhook envelope. We accept either a wrapped
// `{ type: "INSERT", table, schema, record }` payload (the default
// Database Webhook shape) or a flat `{ user_id }` payload to keep the
// receiver friendly to local testing and to future migration to Auth
// Hooks.
const InsertEnvelope = z.object({
  type: z.literal("INSERT"),
  table: z.literal("users"),
  schema: z.literal("auth"),
  record: z.object({
    id: z.string().uuid(),
    email: z.string().email().nullish(),
  }),
});
const FlatPayload = z.object({
  user_id: z.string().uuid(),
});

function extractUserId(payload: unknown): string | null {
  const wrapped = InsertEnvelope.safeParse(payload);
  if (wrapped.success) return wrapped.data.record.id;
  const flat = FlatPayload.safeParse(payload);
  if (flat.success) return flat.data.user_id;
  return null;
}

export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);

  const secret = process.env["SUPABASE_AUTH_WEBHOOK_SECRET"];
  if (!secret) {
    logServerEvent("error", "auth webhook: secret not configured", {
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
    logServerEvent("warn", "auth webhook: bearer rejected", { requestId });
    return apiError(401, "UNAUTHORIZED", "Invalid credentials", requestId);
  }

  let parsedJson: unknown;
  try {
    parsedJson = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body", requestId);
  }

  const userId = extractUserId(parsedJson);
  if (!userId) {
    return apiError(
      400,
      "BAD_REQUEST",
      "Payload missing user id (expected INSERT envelope or { user_id })",
      requestId,
    );
  }

  try {
    const outcome = await seedDefaultGrowForUser({ userId });
    if (outcome.kind === "already_has_grow") {
      logServerEvent("info", "auth webhook: user already onboarded", {
        requestId,
        userId,
        growCount: outcome.growCount,
      });
      return apiSuccess(
        200,
        { user_id: userId, seeded: false, reason: "already_onboarded" },
        requestId,
      );
    }
    logServerEvent("info", "auth webhook: seeded default grow", {
      requestId,
      userId,
      growId: outcome.growId,
    });
    return apiSuccess(
      200,
      { user_id: userId, seeded: true, grow_id: outcome.growId },
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "auth webhook: onboarding failed", {
      requestId,
      userId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(500, "INTERNAL_ERROR", "Failed to onboard user", requestId);
  }
}
