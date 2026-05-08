"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { GrowMedium, GrowStage, LightType } from "@phenosage/shared";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";

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

export type CreateGrowActionResult = {
  fieldErrors?: {
    lightType?: string;
    medium?: string;
    name?: string;
    stage?: string;
    startDate?: string;
    targetHarvestDate?: string;
  };
  message?: string;
  status: "error" | "idle";
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("grows").insert({
    description: description || null,
    light_type: lightType as LightType,
    medium: medium as GrowMedium,
    name,
    owner_id: user.id,
    stage: stage as GrowStage,
    start_date: startDate,
    target_harvest_date: targetHarvestDate || null,
  });

  if (error) {
    return {
      message: error.message,
      status: "error",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/grows");
  revalidatePath("/plants");
  redirect("/grows");
}
