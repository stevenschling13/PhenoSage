"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/server/auth";

export type CreateGrowState = {
  ok: boolean;
  message: string;
} | null;

const STAGES = [
  "germination",
  "seedling",
  "vegetative",
  "pre_flower",
  "flower",
  "late_flower",
  "harvest",
  "dry_cure",
] as const;
type Stage = (typeof STAGES)[number];

const NAME_MAX = 80;

export async function createGrowAction(
  _prev: CreateGrowState,
  formData: FormData,
): Promise<CreateGrowState> {
  const name = String(formData.get("name") ?? "").trim();
  const stageRaw = String(formData.get("stage") ?? "seedling");

  if (!name) return { ok: false, message: "Give your grow a name." };
  if (name.length > NAME_MAX) {
    return {
      ok: false,
      message: `Name must be ${NAME_MAX} characters or less.`,
    };
  }

  const stage: Stage = (STAGES as readonly string[]).includes(stageRaw)
    ? (stageRaw as Stage)
    : "seedling";

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "You're not signed in." };

  const { error } = await supabase
    .from("grows")
    .insert({ owner_id: user.id, name, stage });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/grows");
  revalidatePath("/dashboard");
  return { ok: true, message: `Grow "${name}" created.` };
}
