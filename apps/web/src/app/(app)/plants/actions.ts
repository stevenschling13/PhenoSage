"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";

export type CreatePlantActionResult = {
  fieldErrors?: {
    growId?: string;
    name?: string;
  };
  message?: string;
  status: "error" | "idle";
};

export const createPlantActionInitialState: CreatePlantActionResult = {
  status: "idle",
};

function asTrimmedString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function createPlantAction(
  formData: FormData,
): Promise<CreatePlantActionResult> {
  const user = await getServerUser();
  if (!user) {
    return {
      message: "You must be signed in to add a plant.",
      status: "error",
    };
  }

  const growId = asTrimmedString(formData.get("growId"));
  const name = asTrimmedString(formData.get("name"));
  const strain = asTrimmedString(formData.get("strain"));
  const batchLabel = asTrimmedString(formData.get("batchLabel"));
  const notes = asTrimmedString(formData.get("notes"));

  const fieldErrors: CreatePlantActionResult["fieldErrors"] = {};

  if (!growId) {
    fieldErrors.growId = "Choose a grow.";
  }

  if (!name) {
    fieldErrors.name = "Plant name is required.";
  } else if (name.length > 120) {
    fieldErrors.name = "Keep the plant name under 120 characters.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      fieldErrors,
      message: "Fix the highlighted fields and try again.",
      status: "error",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data: grow, error: growError } = await supabase
    .from("grows")
    .select("id")
    .eq("id", growId)
    .maybeSingle();

  if (growError) {
    return {
      message: growError.message,
      status: "error",
    };
  }

  if (!grow) {
    return {
      fieldErrors: { growId: "Select a grow you can access." },
      message: "The selected grow is not available.",
      status: "error",
    };
  }

  const { data, error } = await supabase
    .from("plants")
    .insert({
      batch_label: batchLabel || null,
      grow_id: growId,
      name,
      notes: notes || null,
      strain: strain || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      message: error?.message ?? "Failed to create the plant.",
      status: "error",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/grows");
  revalidatePath("/plants");
  redirect(`/plants/${data.id}`);
}
