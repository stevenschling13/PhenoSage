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
// dominate. 60s comfortably covers the TARGET_USERS_LIMIT (100) at
// ~1.5s per AI call with CONCURRENCY=5 fan-out (~30s expected).
export const maxDuration = 60;

// Number of users processed in parallel per batch.
const CONCURRENCY = 5;
// Stop processing new batches once this much wall-clock time has elapsed
// so we return before Vercel terminates the function.
const TIME_BUDGET_MS = 55_000;

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
//      UPSERT a `notifications` row keyed (user_id, kind, occurred_on)
//      with ignoreDuplicates=true. The partial UNIQUE index from
//      migration 015 silently ignores same-day re-runs so no error
//      is returned by PostgREST; a duplicate counts as "skipped".
//
// Failure isolation:
//   * Users are processed in batches of CONCURRENCY=5. A failing AI
//     call for one user does NOT abort the whole run; the user's snapshot
//     is logged and we move on. Processing stops early if TIME_BUDGET_MS
//     is reached so Vercel doesn't terminate mid-run.
//   * The aggregate result payload counts processed / wrote / skipped /
//     errored so dashboards and smoke tests can tell what happened.
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

  for (let i = 0; i < userIds.length; i += CONCURRENCY) {
    if (Date.now() - startedAt.getTime() > TIME_BUDGET_MS) {
      logServerEvent(
        "warn",
        "daily summary: time budget reached, stopping early",
        {
          processed,
          unprocessed: userIds.length - i,
        },
      );
      break;
    }

    await Promise.all(
      userIds.slice(i, i + CONCURRENCY).map(async (userId) => {
        processed++;
        try {
          const snapshot = await buildDigestSnapshot(
            supabase,
            userId,
            startedAt,
          );
          if (!hasMeaningfulActivity(snapshot)) {
            skipped++;
            return;
          }
          const rendered = await renderDigest(snapshot);
          const { data: written, error: upsertError } = await supabase
            .from("notifications")
            .upsert(
              {
                user_id: userId,
                kind: "daily_summary",
                priority: digestPriority(snapshot),
                title: rendered.title,
                body: rendered.body,
                payload: {
                  grows: snapshot.grows.map((g) => ({
                    id: g.id,
                    name: g.name,
                  })),
                  newFindingCount: snapshot.newFindings.length,
                  newImages: snapshot.newImages,
                  newObservations: snapshot.newObservations,
                  newTasks: snapshot.newTasks,
                  resolvedFindings: snapshot.resolvedFindings,
                },
                occurred_on: occurredOn,
              },
              {
                onConflict: "user_id,kind,occurred_on",
                ignoreDuplicates: true,
              },
            )
            .select("id");
          if (upsertError) {
            errored++;
            logServerEvent("error", "daily summary: insert failed", {
              error: upsertError.message,
              code: upsertError.code,
              userId,
            });
          } else if (written && written.length > 0) {
            wrote++;
          } else {
            // Same-day duplicate was silently ignored by the UNIQUE index.
            skipped++;
          }
        } catch (err) {
          errored++;
          logServerEvent("error", "daily summary: user run failed", {
            error: err instanceof Error ? err.message : String(err),
            userId,
          });
        }
      }),
    );
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
