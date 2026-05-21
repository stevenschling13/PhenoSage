import "server-only";
import { getDbClient } from "./db";

export type SeedDefaultGrowOutcome =
  | { kind: "already_has_grow"; growCount: number }
  | { kind: "seeded"; growId: string }
  | { kind: "user_not_found" };

interface SeedDefaultGrowInput {
  userId: string;
}

const DEFAULT_GROW_NAME = "My First Grow";

/**
 * Create a starter `grows` row for a freshly signed-up user so the dashboard
 * doesn't land them in an empty state. Idempotent: skipped if the user
 * already owns any grow row. Uses the service-role client to bypass RLS
 * — this runs from a server-only webhook handler with no authenticated
 * session to map auth.uid() to.
 */
export async function seedDefaultGrowForUser(
  input: SeedDefaultGrowInput,
): Promise<SeedDefaultGrowOutcome> {
  const db = getDbClient();

  const { data: userRow, error: userErr } = await db
    .schema("auth")
    .from("users")
    .select("id")
    .eq("id", input.userId)
    .maybeSingle();
  if (userErr) {
    throw new Error(`Failed to look up auth user: ${userErr.message}`);
  }
  if (!userRow) return { kind: "user_not_found" };

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
