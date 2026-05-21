import "server-only";
import { getDbClient } from "./db";

export type SeedDefaultGrowOutcome =
  | { kind: "already_has_grow"; growCount: number }
  | { kind: "seeded"; growId: string };

interface SeedDefaultGrowInput {
  userId: string;
}

const DEFAULT_GROW_NAME = "My First Grow";

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
  const db = getDbClient();

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
