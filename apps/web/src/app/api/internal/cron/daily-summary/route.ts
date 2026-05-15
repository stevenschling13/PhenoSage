import { NextRequest, NextResponse } from "next/server";

import { getDbClient } from "@/lib/server/db";
import {
  buildDigestSnapshot,
  digestPriority,
  hasMeaningfulActivity,
  listUsersWithActiveGrows,
  renderDigest,
} from "@/lib/server/daily-digest";
import { logServerEvent } from "@/lib/server/request-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel function timeout for daily runs across N users — AI calls
// dominate. 60s comfortably covers ~30 users at ~1.5s per AI call,
// past which we'd want a queue.
export const maxDuration = 60;

// GET /api/internal/cron/daily-summary
//
// Vercel Cron always issues a GET request and signs it with
// `Authorization: Bearer ${CRON_SECRET}` (set in Vercel project settings).
// Never invoked by the browser.
//
// Behavior per user:
//   1. Aggregate last-24h activity (new findings, images, observations,
//      tasks, resolved findings).
//   2. If nothing happened → skip (no AI call, no DB write).
//   3. Otherwise → call the AI to render a 2-3 sentence digest, then
//      INSERT a `notifications` row keyed (user_id, kind, occurred_on).
//      The partial UNIQUE index from migration 014 + ON CONFLICT DO
//      NOTHING makes a same-day re-run a no-op.
//
// Failure isolation:
//   * A failing AI call for one user does NOT abort the whole run; the
//     user's snapshot is logged and we move on. The aggregate result
//     payload counts processed / wrote / skipped / errored so dashboards
//     and smoke tests can tell what happened.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env["CRON_SECRET"];
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const occurredOn = startedAt.toISOString().slice(0, 10); // YYYY-MM-DD UTC

  let supabase: ReturnType<typeof getDbClient>;
  try {
    supabase = getDbClient();
  } catch (err) {
    logServerEvent("error", "daily summary: db client init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 },
    );
  }

  const userIds = await listUsersWithActiveGrows(supabase);
  let processed = 0;
  let wrote = 0;
  let skipped = 0;
  let errored = 0;

  for (const userId of userIds) {
    processed++;
    try {
      const snapshot = await buildDigestSnapshot(supabase, userId, startedAt);
      if (!hasMeaningfulActivity(snapshot)) {
        skipped++;
        continue;
      }
      const rendered = await renderDigest(snapshot);
      const { error: insertError } = await supabase
        .from("notifications")
        .insert({
          user_id: userId,
          kind: "daily_summary",
          priority: digestPriority(snapshot),
          title: rendered.title,
          body: rendered.body,
          payload: {
            grows: snapshot.grows.map((g) => ({ id: g.id, name: g.name })),
            newFindingCount: snapshot.newFindings.length,
            newImages: snapshot.newImages,
            newObservations: snapshot.newObservations,
            newTasks: snapshot.newTasks,
            resolvedFindings: snapshot.resolvedFindings,
          },
          occurred_on: occurredOn,
        });
      if (insertError) {
        // 23505 = same-day duplicate, harmless. Anything else is real.
        if (insertError.code === "23505") {
          skipped++;
        } else {
          errored++;
          logServerEvent("error", "daily summary: insert failed", {
            error: insertError.message,
            code: insertError.code,
            userId,
          });
        }
      } else {
        wrote++;
      }
    } catch (err) {
      errored++;
      logServerEvent("error", "daily summary: user run failed", {
        error: err instanceof Error ? err.message : String(err),
        userId,
      });
    }
  }

  return NextResponse.json({
    status: "ok",
    ran: startedAt.toISOString(),
    occurredOn,
    processed,
    wrote,
    skipped,
    errored,
  });
}
