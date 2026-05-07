"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/server/auth";

export type ProfileFormState = {
  ok: boolean;
  message: string;
} | null;

const MAX_NAME_LEN = 80;

export async function updateProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const raw = String(formData.get("displayName") ?? "").trim();
  if (raw.length > MAX_NAME_LEN) {
    return {
      ok: false,
      message: `Display name must be ${MAX_NAME_LEN} characters or less.`,
    };
  }
  const displayName = raw.length === 0 ? null : raw;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "You're not signed in." };
  }

  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        display_name: displayName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true, message: "Profile updated." };
}
