import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/internal/cron/daily-summary
// Vercel Cron always issues a GET request and signs it with
// `Authorization: Bearer ${CRON_SECRET}` (set in Vercel project settings).
// Never invoked by the browser.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env["CRON_SECRET"];

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: Fetch all active grows
  // TODO: For each grow, compile recent observations + findings
  // TODO: Call AI to generate a daily summary
  // TODO: Persist as grow_events with eventType = 'observation'
  // TODO: Queue notifications (email / push) per user preferences

  return NextResponse.json(
    {
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Daily summary generation is not enabled in this deployment.",
      },
      ran: new Date().toISOString(),
    },
    { status: 501 },
  );
}
