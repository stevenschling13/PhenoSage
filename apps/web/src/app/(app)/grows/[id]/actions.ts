"use server";

import { revalidatePath } from "next/cache";
import type { GrowMedium, GrowStage, LightType } from "@phenosage/shared";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";
import { isNextFrameworkError } from "@/lib/server/auth-errors";
import { logServerEvent } from "@/lib/server/request-id";
import { MAX_DESCRIPTION_LENGTH, MAX_FUTURE_START_MS } from "../constants";

// Stage / medium / light vocabularies are duplicated from
// new/actions.ts on purpose: keeping the two action files independent
// means a vocabulary tweak in one path can't silently break the other.
// If the vocabulary set ever stabilises, hoist into @phenosage/shared.
const validStages: readonly GrowStage[] = [
  "germination",
  "seedling",
  "vegetative",
  "pre_flower",
  "flower",
  "late_flower",
  "harvest",
  "dry_cure",
];
const validStagesSet = new Set<GrowStage>(validStages);
const validMedia = new Set<GrowMedium>([
  "soil",
  "coco",
  "hydro",
  "aero",
  "living_soil",
  "other",
]);
const validLightTypes = new Set<LightType>([
  "hps",
  "cmh",
  "led",
  "t5",
  "sun",
  "mixed",
  "other",
]);

function asTrimmedString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

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

// ─── update grow ───────────────────────────────────────────────────────
// Full edit of the mutable grow fields. Ownership is enforced by RLS
// (`grows: owner write`) so non-owners get a 42501 we surface as a
// clean message. Validation mirrors createGrowAction so a user can't
// reach an invalid state via either path.

export type UpdateGrowActionResult = {
  fieldErrors?: {
    description?: string;
    lightType?: string;
    medium?: string;
    name?: string;
    stage?: string;
    startDate?: string;
    targetHarvestDate?: string;
  };
  message?: string;
  redirectTo?: string;
  status: "error" | "idle" | "success";
};

export const updateGrowActionInitialState: UpdateGrowActionResult = {
  status: "idle",
};

export async function updateGrowAction(
  growId: string,
  formData: FormData,
): Promise<UpdateGrowActionResult> {
  const user = await getServerUser();
  if (!user) {
    return {
      message: "You must be signed in to edit a grow.",
      status: "error",
    };
  }

  if (!growId || typeof growId !== "string") {
    return { message: "Invalid grow id.", status: "error" };
  }

  const name = asTrimmedString(formData.get("name"));
  const description = asTrimmedString(formData.get("description"));
  const stage = asTrimmedString(formData.get("stage"));
  const medium = asTrimmedString(formData.get("medium"));
  const lightType = asTrimmedString(formData.get("lightType"));
  const startDate = asTrimmedString(formData.get("startDate"));
  const targetHarvestDate = asTrimmedString(formData.get("targetHarvestDate"));

  const fieldErrors: UpdateGrowActionResult["fieldErrors"] = {};

  if (!name) {
    fieldErrors.name = "Name is required.";
  } else if (name.length > 120) {
    fieldErrors.name = "Keep the grow name under 120 characters.";
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    fieldErrors.description = `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`;
  }

  if (!validStagesSet.has(stage as GrowStage)) {
    fieldErrors.stage = "Choose a valid grow stage.";
  }

  if (!validMedia.has(medium as GrowMedium)) {
    fieldErrors.medium = "Choose a valid medium.";
  }

  if (!validLightTypes.has(lightType as LightType)) {
    fieldErrors.lightType = "Choose a valid light type.";
  }

  if (!startDate) {
    fieldErrors.startDate = "Start date is required.";
  } else if (!isIsoDate(startDate)) {
    fieldErrors.startDate = "Use a valid start date.";
  } else if (Date.parse(startDate) > Date.now() + MAX_FUTURE_START_MS) {
    fieldErrors.startDate =
      "Start date can't be more than a day in the future.";
  }

  if (targetHarvestDate) {
    if (!isIsoDate(targetHarvestDate)) {
      fieldErrors.targetHarvestDate = "Use a valid target harvest date.";
    } else if (
      startDate &&
      isIsoDate(startDate) &&
      targetHarvestDate < startDate
    ) {
      fieldErrors.targetHarvestDate =
        "Target harvest date must be on or after the start date.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      fieldErrors,
      message: "Fix the highlighted fields and try again.",
      status: "error",
    };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("grows")
      .update({
        description: description || null,
        light_type: lightType as LightType,
        medium: medium as GrowMedium,
        name,
        stage: stage as GrowStage,
        start_date: startDate,
        target_harvest_date: targetHarvestDate || null,
      })
      .eq("id", growId);

    if (error) {
      logServerEvent("error", "update grow failed", {
        error: error.message,
        code: error.code,
        growId,
        userId: user.id,
      });
      if (error.code === "23505") {
        // Partial UNIQUE on (owner_id, lower(name)) WHERE is_archived=false
        return {
          fieldErrors: {
            name: "Another active grow already uses this name.",
          },
          message: "Pick a different name and try again.",
          status: "error",
        };
      }
      if (error.code === "42501" || /row-level security/i.test(error.message)) {
        return {
          message: "Only the grow owner can edit this grow.",
          status: "error",
        };
      }
      return {
        message: "We couldn't save your changes right now. Please try again.",
        status: "error",
      };
    }
  } catch (err) {
    if (isNextFrameworkError(err)) throw err;
    logServerEvent("error", "update grow action threw", {
      error: err instanceof Error ? err.message : String(err),
      growId,
      userId: user.id,
    });
    return {
      message: "We couldn't save your changes right now. Please try again.",
      status: "error",
    };
  }

  revalidatePath("/grows");
  revalidatePath(`/grows/${growId}`);
  revalidatePath("/dashboard");

  return {
    message: "Grow updated.",
    redirectTo: `/grows/${growId}`,
    status: "success",
  };
}

// ─── advance grow stage ────────────────────────────────────────────────
// One-click stage transition used by the detail page's stepper. Allows
// any vocabulary stage as the next value (forward and backward) — the
// stepper UI presents the linear "next" option, but a future panel that
// lets owners jump backward shouldn't have to introduce a second
// action. Owner-only via RLS.

export type AdvanceGrowStageActionResult = {
  message?: string;
  status: "error" | "idle" | "success";
};

export const advanceGrowStageActionInitialState: AdvanceGrowStageActionResult =
  {
    status: "idle",
  };

export async function advanceGrowStageAction(
  growId: string,
  nextStage: GrowStage,
): Promise<AdvanceGrowStageActionResult> {
  const user = await getServerUser();
  if (!user) {
    return {
      message: "You must be signed in to update the grow stage.",
      status: "error",
    };
  }

  if (!growId || typeof growId !== "string") {
    return { message: "Invalid grow id.", status: "error" };
  }

  if (!validStagesSet.has(nextStage)) {
    return { message: "Choose a valid grow stage.", status: "error" };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("grows")
      .update({ stage: nextStage })
      .eq("id", growId);

    if (error) {
      logServerEvent("error", "advance grow stage failed", {
        error: error.message,
        code: error.code,
        growId,
        userId: user.id,
        nextStage,
      });
      if (error.code === "42501" || /row-level security/i.test(error.message)) {
        return {
          message: "Only the grow owner can change the stage.",
          status: "error",
        };
      }
      return {
        message: "We couldn't update the stage right now. Please try again.",
        status: "error",
      };
    }
  } catch (err) {
    if (isNextFrameworkError(err)) throw err;
    logServerEvent("error", "advance grow stage threw", {
      error: err instanceof Error ? err.message : String(err),
      growId,
      userId: user.id,
    });
    return {
      message: "We couldn't update the stage right now. Please try again.",
      status: "error",
    };
  }

  revalidatePath("/grows");
  revalidatePath(`/grows/${growId}`);
  revalidatePath("/dashboard");

  return { message: `Stage set to ${nextStage}.`, status: "success" };
}

// ─── hard delete grow ──────────────────────────────────────────────────
// Destructive. Requires the user to retype the grow name (case- and
// whitespace-insensitive) — same friction pattern GitHub uses for repo
// deletion. RLS pins this to owners; FK cascades cleanly drop plants,
// images, analyses, jobs, members, tasks, observations, events, and
// findings. `chat_threads.grow_id` is SET NULL on purpose, so any
// assistant chat scoped here unscope's rather than disappearing.

export type DeleteGrowActionResult = {
  message?: string;
  redirectTo?: string;
  status: "error" | "idle" | "success";
};

export const deleteGrowActionInitialState: DeleteGrowActionResult = {
  status: "idle",
};

function normaliseName(value: string) {
  return value.trim().toLowerCase();
}

export async function deleteGrowAction(
  growId: string,
  confirmName: string,
): Promise<DeleteGrowActionResult> {
  const user = await getServerUser();
  if (!user) {
    return {
      message: "You must be signed in to delete a grow.",
      status: "error",
    };
  }

  if (!growId || typeof growId !== "string") {
    return { message: "Invalid grow id.", status: "error" };
  }

  const typed = typeof confirmName === "string" ? confirmName : "";
  if (!typed.trim()) {
    return {
      message: "Type the grow name exactly to confirm deletion.",
      status: "error",
    };
  }

  try {
    const supabase = await createSupabaseServerClient();

    // Read the row first so the confirmation guard can't be defeated by
    // forging the form's hidden name. Membership is RLS-gated so this
    // also doubles as the access check before destructive work.
    const { data: existing, error: readError } = await supabase
      .from("grows")
      .select("id,name,owner_id")
      .eq("id", growId)
      .maybeSingle();

    if (readError) {
      logServerEvent("error", "delete grow read failed", {
        error: readError.message,
        code: readError.code,
        growId,
        userId: user.id,
      });
      return {
        message: "We couldn't load the grow to delete. Please try again.",
        status: "error",
      };
    }

    if (!existing) {
      // Either deleted already or RLS hid it. Treat as a successful
      // no-op so the UI can navigate away cleanly.
      revalidatePath("/grows");
      revalidatePath("/dashboard");
      return {
        message: "Grow deleted.",
        redirectTo: "/grows?deleted=1",
        status: "success",
      };
    }

    if (existing.owner_id !== user.id) {
      return {
        message: "Only the grow owner can delete it.",
        status: "error",
      };
    }

    if (normaliseName(existing.name) !== normaliseName(typed)) {
      return {
        message:
          "The name you typed doesn't match. Type the grow name exactly to confirm.",
        status: "error",
      };
    }

    const { error: deleteError } = await supabase
      .from("grows")
      .delete()
      .eq("id", growId);

    if (deleteError) {
      logServerEvent("error", "delete grow failed", {
        error: deleteError.message,
        code: deleteError.code,
        growId,
        userId: user.id,
      });
      if (
        deleteError.code === "42501" ||
        /row-level security/i.test(deleteError.message)
      ) {
        return {
          message: "Only the grow owner can delete it.",
          status: "error",
        };
      }
      return {
        message: "We couldn't delete the grow right now. Please try again.",
        status: "error",
      };
    }
  } catch (err) {
    if (isNextFrameworkError(err)) throw err;
    logServerEvent("error", "delete grow action threw", {
      error: err instanceof Error ? err.message : String(err),
      growId,
      userId: user.id,
    });
    return {
      message: "We couldn't delete the grow right now. Please try again.",
      status: "error",
    };
  }

  revalidatePath("/grows");
  revalidatePath("/dashboard");

  return {
    message: "Grow deleted.",
    redirectTo: "/grows?deleted=1",
    status: "success",
  };
}
