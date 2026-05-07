import "server-only";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";

type AuthorizedPlantRow = {
  id: string;
  name: string;
  strain: string | null;
  notes: string | null;
  grow_id: string;
  grows: {
    id: string;
    stage: string | null;
    medium: string | null;
    light_type: string | null;
    start_date: string | null;
  } | null;
};

export type AuthorizedPlantContext = {
  userId: string;
  plantId: string;
  plantName: string;
  strain: string | null;
  notes: string | null;
  growId: string;
  growStage: string | null;
  medium: string | null;
  lightType: string | null;
  startDate: string | null;
};

export async function getAuthorizedPlantContext(
  plantId: string,
): Promise<AuthorizedPlantContext | null> {
  const user = await getServerUser();
  if (!user) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("plants")
    .select(
      "id,name,strain,notes,grow_id,grows!inner(id,stage,medium,light_type,start_date)",
    )
    .eq("id", plantId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to authorize plant access: ${error.message}`);
  }

  const plant = data as AuthorizedPlantRow | null;
  if (!plant) {
    return null;
  }

  return {
    userId: user.id,
    plantId: plant.id,
    plantName: plant.name,
    strain: plant.strain,
    notes: plant.notes,
    growId: plant.grow_id,
    growStage: plant.grows?.stage ?? null,
    medium: plant.grows?.medium ?? null,
    lightType: plant.grows?.light_type ?? null,
    startDate: plant.grows?.start_date ?? null,
  };
}
