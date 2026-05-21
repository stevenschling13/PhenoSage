import "server-only";
import { getDbClient } from "./db";
import { logServerEvent } from "./request-id";

type SupabaseDbClient = ReturnType<typeof getDbClient>;

export type SeedDefaultGrowOutcome =
  | { kind: "already_has_grow"; growCount: number }
  | { kind: "seeded"; growId: string };

interface SeedDefaultGrowInput {
  userId: string;
  /**
   * Optional caller-supplied service-role client. Defaults to a fresh
   * `getDbClient()` per call. Pass an explicit client when looping over
   * many users (e.g. the reconcile cron) so we don't instantiate a new
   * Supabase JS client per iteration.
   */
  db?: SupabaseDbClient;
}

const DEFAULT_GROW_NAME = "My First Grow";

// Cap on how many orphan users a single reconciliation cron tick processes.
// Each user costs a count + insert round-trip. At ~50ms per pair over the
// public internet (Vercel → Supabase), 200 users ≈ 10s — comfortably under
// the 60s Vercel cron budget with plenty of headroom for retries and
// network jitter. A persistent backlog will drain on subsequent ticks.
const RECONCILE_BATCH_LIMIT = 200;

/**
 * Create a starter `grows` row for a freshly signed-up user so the dashboard
 * doesn't land them in an empty state. Idempotent: skipped if the user
 * already owns any grow row.
 *
 * Uses the service-role client to bypass RLS. We deliberately do NOT verify
 * the user exists in `auth.users` first — Supabase's `auth` schema isn't
 * exposed through PostgREST by default, and the trigger that calls us
 * already fired AFTER an INSERT into `auth.users`, so the row provably
 * existed at trigger time. If the user was deleted between insert and
 * processing (a vanishingly rare race), the `grows.owner_id` FK to
 * `auth.users(id)` will reject the insert and the caller surfaces a 500.
 */
export async function seedDefaultGrowForUser(
  input: SeedDefaultGrowInput,
): Promise<SeedDefaultGrowOutcome> {
  const db = input.db ?? getDbClient();

  const { count: existing, error: countErr } = await db
    .from("grows")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", input.userId);
  if (countErr) {
    throw new Error(`Failed to count existing grows: ${countErr.message}`);
  }
  if ((existing ?? 0) > 0) {
    return { kind: "already_has_grow", growCount: existing ?? 0 };
  }

  const { data: inserted, error: insertErr } = await db
    .from("grows")
    .insert({
      owner_id: input.userId,
      name: DEFAULT_GROW_NAME,
    })
    .select("id")
    .single();
  if (insertErr) {
    throw new Error(`Failed to seed default grow: ${insertErr.message}`);
  }

  return { kind: "seeded", growId: inserted.id };
}

export interface ReconcileOnboardingReport {
  scanned: number;
  seeded: number;
  errored: number;
}

/**
 * Find all `auth.users` rows that have zero `grows` rows and seed a
 * default grow for each. Defends against the `pg_net`-backed Database
 * Webhook silently dropping an `auth.users` INSERT — see migration
 * 20260521190000 for the SECURITY DEFINER function this calls.
 *
 * Bounded to `RECONCILE_BATCH_LIMIT` users per tick so a single cron
 * run can't run past Vercel's function timeout. A persistent backlog
 * will drain on subsequent daily ticks.
 */
export async function reconcileOnboarding(): Promise<ReconcileOnboardingReport> {
  const db = getDbClient();
  const { data: rows, error } = await db.rpc(
    "find_users_without_default_grow",
    {
      p_limit: RECONCILE_BATCH_LIMIT,
    },
  );
  if (error) {
    throw new Error(`Failed to enumerate orphan users: ${error.message}`);
  }

  const userIds: string[] = Array.isArray(rows)
    ? rows
        .map((r) =>
          typeof r === "string"
            ? r
            : r && typeof r === "object" && "id" in r
              ? String((r as { id: unknown }).id)
              : null,
        )
        .filter((v): v is string => v !== null)
    : [];

  let seeded = 0;
  let errored = 0;
  for (const userId of userIds) {
    try {
      // Reuse the single service-role client across the loop instead of
      // instantiating a fresh Supabase JS client per user — avoids the
      // memory + socket overhead of N clients per cron tick.
      const outcome = await seedDefaultGrowForUser({ userId, db });
      if (outcome.kind === "seeded") seeded++;
      // already_has_grow is possible if a webhook delivered between the
      // enumerate and the seed — counted as a no-op, not an error.
    } catch (err) {
      errored++;
      logServerEvent("error", "reconcile-onboarding: per-user seed failed", {
        userId,
        error: err instanceof Error ? err.message : "unknown_error",
      });
    }
  }

  return { scanned: userIds.length, seeded, errored };
}
