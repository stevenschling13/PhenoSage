"use server";

import { revalidatePath } from "next/cache";
import { getServerUser } from "@/lib/server/auth";
import { getDbClient } from "@/lib/server/db";

export type UpdateDisplayNameActionResult = {
  message?: string;
  status: "error" | "idle" | "success";
};

export const updateDisplayNameActionInitialState: UpdateDisplayNameActionResult =
  {
    status: "idle",
  };

function asTrimmedString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function updateDisplayNameAction(
  formData: FormData,
): Promise<UpdateDisplayNameActionResult> {
  const user = await getServerUser();
  if (!user) {
    return {
      message: "You must be signed in to update your profile.",
      status: "error",
    };
  }

  const displayName = asTrimmedString(formData.get("displayName"));
  if (displayName.length > 60) {
    return {
      message: "Keep the display name under 60 characters.",
      status: "error",
    };
  }

  const db = getDbClient();
  const { error } = await db.from("profiles").upsert(
    {
      display_name: displayName || null,
      id: user.id,
    },
    { onConflict: "id" },
  );

  if (error) {
    return {
      message:
        error.code === "23505"
          ? "That display name is already in use."
          : error.message,
      status: "error",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/settings");

  return {
    message: displayName
      ? "Display name saved."
      : "Display name cleared. Email will be used as the fallback label.",
    status: "success",
  };
}
