import "server-only";
import { createSupabaseServerClient } from "./auth";

type GrowRow = {
  id: string;
  light_type: string | null;
  medium: string | null;
  name: string;
  stage: string | null;
  start_date: string | null;
  updated_at: string;
};

type PlantRow = {
  batch_label: string | null;
  grow_id: string;
  grows:
    | {
        id: string;
        name: string;
        stage: string | null;
      }[]
    | null;
  id: string;
  name: string;
  notes: string | null;
  strain: string | null;
  updated_at: string;
};

export type GrowRecord = {
  id: string;
  lightType: string | null;
  medium: string | null;
  name: string;
  stage: string | null;
  startDate: string | null;
  updatedAt: string;
};

export type PlantRecord = {
  batchLabel: string | null;
  grow: {
    id: string;
    name: string;
    stage: string | null;
  } | null;
  growId: string;
  id: string;
  name: string;
  notes: string | null;
  strain: string | null;
  updatedAt: string;
};

function hasSupabaseEnv() {
  return Boolean(
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  );
}

export async function listAccessibleGrows(): Promise<GrowRecord[]> {
  if (!hasSupabaseEnv()) {
    return [];
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("grows")
    .select("id,name,stage,medium,light_type,start_date,updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(`Failed to load grows: ${error.message}`);
  }

  return ((data ?? []) as GrowRow[]).map((grow) => ({
    id: grow.id,
    lightType: grow.light_type,
    medium: grow.medium,
    name: grow.name,
    stage: grow.stage,
    startDate: grow.start_date,
    updatedAt: grow.updated_at,
  }));
}

export async function listAccessiblePlants(): Promise<PlantRecord[]> {
  if (!hasSupabaseEnv()) {
    return [];
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("plants")
    .select(
      "id,name,strain,batch_label,notes,grow_id,updated_at,grows!inner(id,name,stage)",
    )
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Failed to load plants: ${error.message}`);
  }

  return ((data ?? []) as PlantRow[]).map((plant) => ({
    batchLabel: plant.batch_label,
    grow: plant.grows?.[0]
      ? {
          id: plant.grows[0].id,
          name: plant.grows[0].name,
          stage: plant.grows[0].stage,
        }
      : null,
    growId: plant.grow_id,
    id: plant.id,
    name: plant.name,
    notes: plant.notes,
    strain: plant.strain,
    updatedAt: plant.updated_at,
  }));
}
