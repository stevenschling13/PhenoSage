"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";
import { isNextFrameworkError } from "@/lib/server/auth-errors";
import { logServerEvent } from "@/lib/server/request-id";

export type CreatePlantActionResult = {
  fieldErrors?: {
    growId?: string;
    name?: string;
  };
  message?: string;
  redirectTo?: string;
  status: "error" | "idle" | "success";
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

  try {
    const supabase = await createSupabaseServerClient();
    const { data: grow, error: growError } = await supabase
      .from("grows")
      .select("id")
      .eq("id", growId)
      .maybeSingle();

    if (growError) {
      logServerEvent("error", "create plant grow lookup failed", {
        error: growError.message,
        userId: user.id,
        growId,
      });
      return {
        message:
          "We couldn't verify the selected grow. Please try again in a moment.",
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
      logServerEvent("error", "create plant insert failed", {
        error: error?.message ?? "no row returned",
        userId: user.id,
        growId,
      });
      return {
        message:
          error?.code === "23505"
            ? "A plant with that name already exists in this grow."
            : "We couldn't save the plant right now. Please try again in a moment.",
        status: "error",
      };
    }

    revalidatePath("/dashboard");
    revalidatePath("/grows");
    revalidatePath("/plants");

    return {
      message: "Plant created.",
      redirectTo: `/plants/${data.id}`,
      status: "success",
    };
  } catch (err) {
    if (isNextFrameworkError(err)) throw err;
    logServerEvent("error", "create plant action threw", {
      error: err instanceof Error ? err.message : String(err),
      userId: user.id,
    });
    return {
      message:
        "We couldn't save the plant right now. Please try again in a moment.",
      status: "error",
    };
  }
}
