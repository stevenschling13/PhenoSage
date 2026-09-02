import { NextRequest, NextResponse } from "next/server";

import { reconcileOnboarding } from "@/lib/server/onboarding";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";
import { verifyBearerToken } from "@/lib/server/shared-secret";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 60s is the same budget the daily-summary cron uses. The migration's
// bounded `p_limit` keeps a worst-case sweep well under that.
export const maxDuration = 60;

// GET /api/internal/cron/reconcile-onboarding
//
// Vercel Cron daily job. Defends against the `pg_net`-backed
// /api/internal/webhooks/auth/user-created Database Webhook silently
// dropping an `auth.users` INSERT — finds users with zero `grows` rows
// and seeds a default grow for each via the existing onboarding helper.
//
// Auth: `Authorization: Bearer ${CRON_SECRET}`, matching the
// daily-summary cron pattern. Vercel Cron signs every invocation with
// this header; manual `curl` against prod requires the same.
export async function GET(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);

  const cronSecret = process.env["CRON_SECRET"];
  if (!cronSecret) {
    logServerEvent("error", "reconcile-onboarding: CRON_SECRET not set", {
      requestId,
    });
    return NextResponse.json(
      { error: "Cron secret not configured", requestId },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!verifyBearerToken(authHeader, cronSecret)) {
    return NextResponse.json(
      { error: "Unauthorized", requestId },
      { status: 401 },
    );
  }

  const startedAt = new Date();
  try {
    const report = await reconcileOnboarding();
    const durationMs = Date.now() - startedAt.getTime();
    logServerEvent("info", "reconcile-onboarding: complete", {
      requestId,
      ...report,
      durationMs,
    });
    return NextResponse.json({
      status: "ok",
      ran: startedAt.toISOString(),
      ...report,
      durationMs,
    });
  } catch (err) {
    logServerEvent("error", "reconcile-onboarding: failed", {
      requestId,
      error: err instanceof Error ? err.message : "unknown_error",
    });
    return NextResponse.json(
      {
        error: "Reconciliation failed",
        requestId,
        message: err instanceof Error ? err.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
