import "server-only";
import { createSupabaseServerClient, getServerUser } from "./auth";

type ProfileRow = {
  display_name: string | null;
};

export type CurrentProfile = {
  displayName: string | null;
  email: string | null;
  id: string;
};

export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const user = await getServerUser();
  if (!user) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load current profile: ${error.message}`);
  }

  const profile = data as ProfileRow | null;

  return {
    displayName: profile?.display_name ?? null,
    email: user.email ?? null,
    id: user.id,
  };
}
