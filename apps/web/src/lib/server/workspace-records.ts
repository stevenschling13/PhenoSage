import "server-only";
import { createSupabaseServerClient } from "./auth";
import { logServerEvent } from "./request-id";

type GrowRow = {
  id: string;
  is_archived?: boolean;
  light_type: string | null;
  medium: string | null;
  name: string;
  stage: string | null;
  start_date: string | null;
  updated_at: string;
};

type GrowDetailRow = {
  description: string | null;
  id: string;
  is_archived: boolean;
  light_type: string | null;
  medium: string | null;
  name: string;
  owner_id: string;
  stage: string | null;
  start_date: string | null;
  target_harvest_date: string | null;
  updated_at: string;
};

type GrowPlantRow = {
  batch_label: string | null;
  id: string;
  is_archived: boolean;
  name: string;
  strain: string | null;
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
  isArchived: boolean;
  lightType: string | null;
  medium: string | null;
  name: string;
  stage: string | null;
  startDate: string | null;
  updatedAt: string;
};

export type GrowDetail = {
  description: string | null;
  id: string;
  isArchived: boolean;
  lightType: string | null;
  medium: string | null;
  name: string;
  ownerId: string;
  stage: string | null;
  startDate: string | null;
  targetHarvestDate: string | null;
  updatedAt: string;
};

export type GrowPlantSummary = {
  batchLabel: string | null;
  id: string;
  isArchived: boolean;
  name: string;
  strain: string | null;
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

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    logServerEvent("error", "list grows client init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  // Order: active grows first (is_archived=false), then archived,
  // each group by updated_at DESC. Showing archived rows inline (not
  // hidden behind a toggle) is a deliberate product call so users
  // don't lose old data they need to reference. The Archived badge
  // in the registry makes the state obvious.
  const { data, error } = await supabase
    .from("grows")
    .select("id,name,stage,medium,light_type,start_date,is_archived,updated_at")
    .order("is_archived", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    // Degrade to an empty list so list pages remain renderable. The
    // underlying issue is captured in server logs for diagnosis.
    logServerEvent("error", "list grows query failed", {
      error: error.message,
    });
    return [];
  }

  return ((data ?? []) as GrowRow[]).map((grow) => ({
    id: grow.id,
    isArchived: grow.is_archived ?? false,
    lightType: grow.light_type,
    medium: grow.medium,
    name: grow.name,
    stage: grow.stage,
    startDate: grow.start_date,
    updatedAt: grow.updated_at,
  }));
}

// Fetch a single grow + its plant summaries. Returns null if the row
// isn't accessible (RLS, missing, or query failure). Degrading to null
// — rather than throwing — lets the detail page render a clean
// "not found" state instead of a 500.
export async function fetchGrowDetail(
  growId: string,
): Promise<{ grow: GrowDetail; plants: GrowPlantSummary[] } | null> {
  if (!hasSupabaseEnv() || !growId) return null;

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    logServerEvent("error", "fetch grow detail client init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const { data: growData, error: growError } = await supabase
    .from("grows")
    .select(
      "id,name,description,stage,medium,light_type,start_date,target_harvest_date,is_archived,owner_id,updated_at",
    )
    .eq("id", growId)
    .maybeSingle();

  if (growError || !growData) {
    if (growError) {
      logServerEvent("error", "fetch grow detail query failed", {
        error: growError.message,
        growId,
      });
    }
    return null;
  }
  const grow = growData as GrowDetailRow;

  const { data: plantsData, error: plantsError } = await supabase
    .from("plants")
    .select("id,name,strain,batch_label,is_archived,updated_at")
    .eq("grow_id", growId)
    .order("is_archived", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(200);

  if (plantsError) {
    // Plant list is best-effort — surface the grow with an empty plant
    // list rather than failing the whole page.
    logServerEvent("error", "fetch grow plants query failed", {
      error: plantsError.message,
      growId,
    });
  }
  const plants = ((plantsData ?? []) as GrowPlantRow[]).map((p) => ({
    batchLabel: p.batch_label,
    id: p.id,
    isArchived: p.is_archived,
    name: p.name,
    strain: p.strain,
    updatedAt: p.updated_at,
  }));

  return {
    grow: {
      description: grow.description,
      id: grow.id,
      isArchived: grow.is_archived,
      lightType: grow.light_type,
      medium: grow.medium,
      name: grow.name,
      ownerId: grow.owner_id,
      stage: grow.stage,
      startDate: grow.start_date,
      targetHarvestDate: grow.target_harvest_date,
      updatedAt: grow.updated_at,
    },
    plants,
  };
}

export async function listAccessiblePlants(): Promise<PlantRecord[]> {
  if (!hasSupabaseEnv()) {
    return [];
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    logServerEvent("error", "list plants client init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const { data, error } = await supabase
    .from("plants")
    .select(
      "id,name,strain,batch_label,notes,grow_id,updated_at,grows!inner(id,name,stage)",
    )
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    logServerEvent("error", "list plants query failed", {
      error: error.message,
    });
    return [];
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
