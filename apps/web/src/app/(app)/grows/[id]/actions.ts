"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";
import { isNextFrameworkError } from "@/lib/server/auth-errors";
import { logServerEvent } from "@/lib/server/request-id";

export type ToggleArchiveActionResult = {
  message?: string;
  redirectTo?: string;
  status: "error" | "idle" | "success";
};

export const toggleArchiveActionInitialState: ToggleArchiveActionResult = {
  status: "idle",
};

// Toggle a grow's `is_archived` flag. Owner-only — enforced by RLS
// ("grows: owner write" policy from migration 001), so an unauthorised
// user gets a clean error rather than silently no-op'ing.
//
// `nextValue` is passed explicitly (instead of having the server flip
// based on current state) so the form is idempotent: clicking
// "Archive" while archived has no surprise effect.
//
// Archiving a grow with an active duplicate-name partner is now
// allowed because the UNIQUE index from migration 011 is partial
// (WHERE is_archived = false). Un-archiving a grow whose name collides
// with an active grow will hit 23505 and we surface a clear message.
export async function toggleGrowArchiveAction(
  growId: string,
  nextValue: boolean,
): Promise<ToggleArchiveActionResult> {
  const user = await getServerUser();
  if (!user) {
    return {
      message: "You must be signed in to archive a grow.",
      status: "error",
    };
  }

  if (!growId || typeof growId !== "string") {
    return {
      message: "Invalid grow id.",
      status: "error",
    };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("grows")
      .update({ is_archived: nextValue })
      .eq("id", growId);

    if (error) {
      logServerEvent("error", "toggle grow archive failed", {
        error: error.message,
        code: error.code,
        growId,
        userId: user.id,
        nextValue,
      });
      if (error.code === "23505") {
        // Partial unique index trips on un-archive when another active
        // grow already owns the name. Tell the user how to recover.
        return {
          message:
            "Can't unarchive: another active grow already uses this name. Rename one of them first.",
          status: "error",
        };
      }
      if (error.code === "42501" || /row-level security/i.test(error.message)) {
        return {
          message: "Only the grow owner can change its archive state.",
          status: "error",
        };
      }
      return {
        message: "We couldn't update the grow right now. Please try again.",
        status: "error",
      };
    }
  } catch (err) {
    if (isNextFrameworkError(err)) throw err;
    logServerEvent("error", "toggle grow archive threw", {
      error: err instanceof Error ? err.message : String(err),
      growId,
      userId: user.id,
    });
    return {
      message: "We couldn't update the grow right now. Please try again.",
      status: "error",
    };
  }

  revalidatePath("/grows");
  revalidatePath(`/grows/${growId}`);
  revalidatePath("/dashboard");

  return {
    message: nextValue ? "Grow archived." : "Grow restored.",
    redirectTo: `/grows/${growId}`,
    status: "success",
  };
}
