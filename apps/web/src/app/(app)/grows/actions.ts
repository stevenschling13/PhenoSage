"use server";

import { revalidatePath } from "next/cache";
import type { GrowMedium, GrowStage, LightType } from "@phenosage/shared";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";
import { isNextFrameworkError } from "@/lib/server/auth-errors";
import { logServerEvent } from "@/lib/server/request-id";

const validStages = new Set<GrowStage>([
  "germination",
  "seedling",
  "vegetative",
  "pre_flower",
  "flower",
  "late_flower",
  "harvest",
  "dry_cure",
]);

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

// Mirrors the chat tool's MAX_NOTES_LENGTH so both create paths agree
// on prose size. The DB column is unbounded `text`; cap here to keep
// list views renderable and lock out paste-bomb fat-fingers.
const MAX_DESCRIPTION_LENGTH = 2_000;

// Mirrors the chat tool's isoDateNotFarFuture refinement: past start
// dates are allowed (data-entry catching up is the common case), but
// the future side is clamped to avoid year-9999 fat-finger inputs.
const MAX_FUTURE_START_MS = 24 * 60 * 60 * 1000;

export type CreateGrowActionResult = {
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

export const createGrowActionInitialState: CreateGrowActionResult = {
  status: "idle",
};

function asTrimmedString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export async function createGrowAction(
  formData: FormData,
): Promise<CreateGrowActionResult> {
  const user = await getServerUser();
  if (!user) {
    return {
      message: "You must be signed in to create a grow.",
      status: "error",
    };
  }

  const name = asTrimmedString(formData.get("name"));
  const description = asTrimmedString(formData.get("description"));
  const stage = asTrimmedString(formData.get("stage"));
  const medium = asTrimmedString(formData.get("medium"));
  const lightType = asTrimmedString(formData.get("lightType"));
  const startDate = asTrimmedString(formData.get("startDate"));
  const targetHarvestDate = asTrimmedString(formData.get("targetHarvestDate"));

  const fieldErrors: CreateGrowActionResult["fieldErrors"] = {};

  if (!name) {
    fieldErrors.name = "Name is required.";
  } else if (name.length > 120) {
    fieldErrors.name = "Keep the grow name under 120 characters.";
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    fieldErrors.description = `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`;
  }

  if (!validStages.has(stage as GrowStage)) {
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

  let newGrowId: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("grows")
      .insert({
        description: description || null,
        light_type: lightType as LightType,
        medium: medium as GrowMedium,
        name,
        owner_id: user.id,
        stage: stage as GrowStage,
        start_date: startDate,
        target_harvest_date: targetHarvestDate || null,
      })
      .select("id")
      .single();

    if (error || !data) {
      logServerEvent("error", "create grow insert failed", {
        error: error?.message ?? "no row returned",
        errorCode: error?.code ?? null,
        hasDescription: description.length > 0,
        hasTargetHarvestDate: targetHarvestDate.length > 0,
        lightType,
        medium,
        nameLength: name.length,
        stage,
        userId: user.id,
      });
      return {
        message:
          error?.code === "23505"
            ? "A grow with that name already exists. Try a different name."
            : "We couldn't save the grow right now. Please try again in a moment.",
        status: "error",
      };
    }

    newGrowId = data.id;

    revalidatePath("/dashboard");
    revalidatePath("/grows");
    revalidatePath("/plants");
  } catch (err) {
    // Re-throw Next framework control-flow signals untouched.
    if (isNextFrameworkError(err)) throw err;
    logServerEvent("error", "create grow action threw", {
      error: err instanceof Error ? err.message : String(err),
      hasDescription: description.length > 0,
      hasTargetHarvestDate: targetHarvestDate.length > 0,
      lightType,
      medium,
      nameLength: name.length,
      stage,
      userId: user.id,
    });
    return {
      message:
        "We couldn't save the grow right now. Please try again in a moment — if it keeps failing, your sign-in may have expired.",
      status: "error",
    };
  }

  // Return a redirectTo instead of calling redirect() here. When this server
  // action is invoked from a client-side `await` inside startTransition, a
  // NEXT_REDIRECT throw cannot be intercepted by the framework and surfaces
  // as an error boundary hit. Letting the client perform router.push avoids
  // that entire failure mode.
  //
  // Land on the grow detail page so the user immediately sees the grow
  // they just created with plant intake one click away. The form's
  // useActionWithRecovery falls back to /grows if /grows/[id] is
  // unreachable for any reason, so users are never stranded.
  const redirectTo = newGrowId
    ? `/grows/${encodeURIComponent(newGrowId)}?just_created=1`
    : "/grows";
  return {
    message: "Grow created.",
    redirectTo,
    status: "success",
  };
}
