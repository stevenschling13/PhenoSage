import { NextRequest, NextResponse } from "next/server";

import { getDbClient } from "@/lib/server/db";
import {
  buildDigestSnapshot,
  digestPriority,
  hasMeaningfulActivity,
  listUsersWithActiveGrows,
  renderDigest,
} from "@/lib/server/daily-digest";
import { dispatchDailySummaryEmail } from "@/lib/server/email-dispatch";
import { logServerEvent } from "@/lib/server/request-id";
import { formatOccurredOnInZone } from "@/lib/server/timezone";
import {
  DEFAULT_USER_PREFERENCES,
  loadUserPreferencesBulk,
} from "@/lib/server/user-preferences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel function timeout for daily runs across N users — AI calls
// dominate. 60s comfortably covers the TARGET_USERS_LIMIT (100) at
// ~1.5s per AI call with CONCURRENCY=5 fan-out (~30s expected).
export const maxDuration = 60;

// Number of users processed in parallel per batch.
const CONCURRENCY = 5;
// Stop processing new batches once this much wall-clock time has elapsed.
// Sized to leave headroom: 60s limit - 5s overhead - worst-case batch time
// (~CONCURRENCY × max-AI-latency ~= 5 × 2s = 10s) → 45s.
const TIME_BUDGET_MS = 45_000;

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
//      with ignoreDuplicates=true. `occurred_on` is the user's *local*
//      calendar date, derived from `user_preferences.timezone` (UTC if
//      no row / unrecognised zone). The partial UNIQUE index from
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
  // `occurred_on` is now computed per-user using their stored timezone
  // (loaded below). `occurredOnUtc` is retained as the response payload
  // and as a fallback so observability still reports "what day did this
  // run on" for operators reading dashboards in UTC.
  const occurredOnUtc = startedAt.toISOString().slice(0, 10); // YYYY-MM-DD UTC

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
  // Bulk-load preferences once so we don't issue N round-trips inside
  // the fan-out. Missing users degrade to UTC inside the helper.
  const preferences = await loadUserPreferencesBulk(supabase, userIds);
  let processed = 0;
  let wrote = 0;
  let skipped = 0;
  let errored = 0;
  let emailed = 0;
  // App URL is read once outside the fan-out so we don't re-read env
  // per-user. Falls back to a sensible local-dev value; this only
  // affects link rendering inside emails — the CTA still resolves.
  const appUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";

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

    // Process a batch concurrently. Each slot returns its outcome so counters
    // are accumulated after the batch — no mutation inside Promise.all.
    type BatchOutcome = {
      result: "wrote" | "skipped" | "errored";
      emailed?: boolean;
    };
    const outcomes = await Promise.all(
      userIds
        .slice(i, i + CONCURRENCY)
        .map(async (userId): Promise<BatchOutcome> => {
          try {
            const snapshot = await buildDigestSnapshot(
              supabase,
              userId,
              startedAt,
            );
            if (!hasMeaningfulActivity(snapshot)) return { result: "skipped" };
            const rendered = await renderDigest(snapshot);
            const userPrefs = preferences.get(userId) ?? {
              ...DEFAULT_USER_PREFERENCES,
            };
            const tz = userPrefs.timezone;
            const occurredOn = formatOccurredOnInZone(startedAt, tz);
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
              logServerEvent("error", "daily summary: insert failed", {
                error: upsertError.message,
                code: upsertError.code,
                userId,
              });
              return { result: "errored" };
            }
            // ignoreDuplicates: empty data means the row already existed today.
            const insertedId = written?.[0]?.id;
            if (!insertedId) {
              return { result: "skipped" };
            }

            // Email is best-effort: failure is logged inside the
            // dispatch helper and never propagates back to the cron.
            // Resend's 24h idempotency key + the row's `email_sent_at`
            // stamp prevent same-day duplicates.
            const dispatch = await dispatchDailySummaryEmail({
              supabase,
              userId,
              notificationId: insertedId,
              preferences: userPrefs,
              snapshot,
              rendered,
              occurredOn,
              appUrl,
            }).catch((err) => {
              logServerEvent("error", "daily summary: email dispatch threw", {
                userId,
                error: err instanceof Error ? err.message : String(err),
              });
              return { sent: false as const, reason: "failed" as const };
            });

            return { result: "wrote", emailed: dispatch.sent };
          } catch (err) {
            logServerEvent("error", "daily summary: user run failed", {
              error: err instanceof Error ? err.message : String(err),
              userId,
            });
            return { result: "errored" };
          }
        }),
    );

    for (const outcome of outcomes) {
      processed++;
      if (outcome.result === "wrote") {
        wrote++;
        if (outcome.emailed) emailed++;
      } else if (outcome.result === "skipped") skipped++;
      else errored++;
    }
  }

  return NextResponse.json({
    status: "ok",
    ran: startedAt.toISOString(),
    occurredOn: occurredOnUtc,
    processed,
    wrote,
    skipped,
    errored,
    emailed,
  });
}
