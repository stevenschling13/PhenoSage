"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";
import { isNextFrameworkError } from "@/lib/server/auth-errors";
import { logServerEvent } from "@/lib/server/request-id";
import type { CreatePlantActionResult } from "./action-state";
import { MAX_BULK_PLANT_COUNT } from "./constants";

function asTrimmedString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCount(value: FormDataEntryValue | null): number | null {
  const raw = asTrimmedString(value);
  if (!raw) return 1;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BULK_PLANT_COUNT) return null;
  return n;
}

function buildBulkNames(prefix: string, count: number): string[] {
  const pad = count >= 10 ? 2 : 1;
  return Array.from(
    { length: count },
    (_, i) => `${prefix} ${String(i + 1).padStart(pad, "0")}`,
  );
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
  const count = parseCount(formData.get("count"));

  const fieldErrors: CreatePlantActionResult["fieldErrors"] = {};

  if (!growId) {
    fieldErrors.growId = "Choose a grow.";
  }

  if (!name) {
    fieldErrors.name = "Plant name is required.";
  } else if (name.length > 120) {
    fieldErrors.name = "Keep the plant name under 120 characters.";
  }

  if (count === null) {
    fieldErrors.count = `Enter a whole number between 1 and ${MAX_BULK_PLANT_COUNT}.`;
  } else if (count > 1 && name.length > 115) {
    // We append " NN" — keep the final name under 120 chars.
    fieldErrors.name =
      "Trim the name prefix so suffixed plant names fit under 120 characters.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      fieldErrors,
      message: "Fix the highlighted fields and try again.",
      status: "error",
    };
  }

  const plantCount = count ?? 1;

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

    const names = plantCount === 1 ? [name] : buildBulkNames(name, plantCount);
    const rows = names.map((plantName) => ({
      batch_label: batchLabel || null,
      grow_id: growId,
      name: plantName,
      notes: notes || null,
      strain: strain || null,
    }));

    const { data, error } = await supabase
      .from("plants")
      .insert(rows)
      .select("id");

    if (error || !data || data.length === 0) {
      logServerEvent("error", "create plant insert failed", {
        error: error?.message ?? "no row returned",
        userId: user.id,
        growId,
        plantCount,
      });
      return {
        message:
          error?.code === "23505"
            ? plantCount === 1
              ? "A plant with that name already exists in this grow."
              : "One of the generated plant names already exists in this grow. Adjust the name prefix and try again."
            : "We couldn't save the plant right now. Please try again in a moment.",
        status: "error",
      };
    }

    revalidatePath("/dashboard");
    revalidatePath("/grows");
    revalidatePath("/plants");

    const firstId = data[0]?.id;
    if (plantCount === 1 && firstId) {
      return {
        message: "Plant created.",
        redirectTo: `/plants/${firstId}`,
        status: "success",
      };
    }

    // For bulk creation, send the operator back to the grow registry where
    // occupancy refreshes immediately. The grows page reads `just_added` +
    // `growId` to surface a "Added N plants to <name>" banner.
    return {
      message: `${plantCount} plants created.`,
      redirectTo: `/grows?just_added=${plantCount}&growId=${encodeURIComponent(growId)}`,
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
