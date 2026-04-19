import { NextRequest, NextResponse } from "next/server";
import { correlationIdFromRequest, createLogger } from "@/lib/server/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/internal/cron/daily-summary
 *
 * Vercel Cron always issues a GET and signs it with
 * `Authorization: Bearer ${CRON_SECRET}`. Never invoked by the browser.
 */
export async function GET(request: NextRequest) {
  const requestId = correlationIdFromRequest(request);
  const log = createLogger({ route: "api.cron.daily_summary", requestId });

  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env["CRON_SECRET"];

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    log.warn("unauthorized cron invocation");
    return NextResponse.json(
      { error: "Unauthorized", requestId },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  log.info("cron invoked");

  // TODO: Fetch all active grows, compile observations + findings, call AI,
  // persist grow_events, queue notifications. Tracked separately; this route
  // stays a no-op until that pipeline lands.
  return NextResponse.json(
    {
      status: "ok",
      ran: new Date().toISOString(),
      message: "daily summary pipeline not yet implemented",
      requestId,
    },
    { headers: { "x-request-id": requestId } },
  );
}
