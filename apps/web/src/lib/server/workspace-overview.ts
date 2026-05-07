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
  grow_id: string;
  id: string;
  name: string;
  updated_at: string;
};

type ImageRow = {
  created_at: string;
  grow_id: string;
  id: string;
  plant_id: string;
};

type FindingRow = {
  created_at: string;
  grow_id: string;
  id: string;
  plant_id: string;
  resolved_at: string | null;
  severity: "critical" | "high" | "info" | "low" | "medium";
  title: string;
};

export type GrowOverview = {
  id: string;
  imageCount: number;
  lightType: string | null;
  medium: string | null;
  name: string;
  openFindingCount: number;
  plantCount: number;
  primaryPlantId: string | null;
  primaryPlantName: string | null;
  stage: string | null;
  startDate: string | null;
  updatedAt: string;
};

export type RecentFinding = {
  createdAt: string;
  growId: string;
  id: string;
  plantId: string;
  plantName: string;
  severity: FindingRow["severity"];
  title: string;
};

export type WorkspaceOverview = {
  grows: GrowOverview[];
  openFindings: number;
  recentActivity: {
    lastCaptureAt: string | null;
    lastPlantUpdateAt: string | null;
  };
  recentFindings: RecentFinding[];
  totals: {
    grows: number;
    images: number;
    plants: number;
  };
};

const EMPTY_WORKSPACE_OVERVIEW: WorkspaceOverview = {
  grows: [],
  openFindings: 0,
  recentActivity: {
    lastCaptureAt: null,
    lastPlantUpdateAt: null,
  },
  recentFindings: [],
  totals: {
    grows: 0,
    images: 0,
    plants: 0,
  },
};

function compareUpdatedAtDescending(
  left: { updatedAt: string },
  right: { updatedAt: string },
) {
  return (
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

export async function getWorkspaceOverview(): Promise<WorkspaceOverview> {
  if (
    !process.env["NEXT_PUBLIC_SUPABASE_URL"] ||
    !process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
  ) {
    return EMPTY_WORKSPACE_OVERVIEW;
  }

  const supabase = await createSupabaseServerClient();

  const [growsResult, plantsResult, imagesResult, findingsResult] =
    await Promise.all([
      supabase
        .from("grows")
        .select("id,name,stage,medium,light_type,start_date,updated_at")
        .order("updated_at", { ascending: false })
        .limit(12),
      supabase
        .from("plants")
        .select("id,name,grow_id,updated_at")
        .order("updated_at", { ascending: false })
        .limit(200),
      supabase
        .from("plant_images")
        .select("id,grow_id,plant_id,created_at")
        .order("created_at", { ascending: false })
        .limit(400),
      supabase
        .from("plant_findings")
        .select("id,grow_id,plant_id,title,severity,resolved_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

  if (growsResult.error) {
    throw new Error(`Failed to load grows: ${growsResult.error.message}`);
  }
  if (plantsResult.error) {
    throw new Error(`Failed to load plants: ${plantsResult.error.message}`);
  }
  if (imagesResult.error) {
    throw new Error(`Failed to load images: ${imagesResult.error.message}`);
  }
  if (findingsResult.error) {
    throw new Error(`Failed to load findings: ${findingsResult.error.message}`);
  }

  const grows = (growsResult.data ?? []) as GrowRow[];
  const plants = (plantsResult.data ?? []) as PlantRow[];
  const images = (imagesResult.data ?? []) as ImageRow[];
  const findings = (findingsResult.data ?? []) as FindingRow[];

  const plantsByGrow = new Map<string, PlantRow[]>();
  const imagesByGrow = new Map<string, ImageRow[]>();
  const unresolvedFindingsByGrow = new Map<string, FindingRow[]>();
  const plantNamesById = new Map<string, string>();

  for (const plant of plants) {
    const current = plantsByGrow.get(plant.grow_id) ?? [];
    current.push(plant);
    plantsByGrow.set(plant.grow_id, current);
    plantNamesById.set(plant.id, plant.name);
  }

  for (const image of images) {
    const current = imagesByGrow.get(image.grow_id) ?? [];
    current.push(image);
    imagesByGrow.set(image.grow_id, current);
  }

  for (const finding of findings) {
    if (finding.resolved_at) {
      continue;
    }
    const current = unresolvedFindingsByGrow.get(finding.grow_id) ?? [];
    current.push(finding);
    unresolvedFindingsByGrow.set(finding.grow_id, current);
  }

  const growOverview = grows
    .map((grow) => {
      const growPlants = plantsByGrow.get(grow.id) ?? [];
      const growImages = imagesByGrow.get(grow.id) ?? [];
      const unresolvedGrowFindings =
        unresolvedFindingsByGrow.get(grow.id) ?? [];
      const primaryPlant = growPlants[0] ?? null;

      return {
        id: grow.id,
        imageCount: growImages.length,
        lightType: grow.light_type,
        medium: grow.medium,
        name: grow.name,
        openFindingCount: unresolvedGrowFindings.length,
        plantCount: growPlants.length,
        primaryPlantId: primaryPlant?.id ?? null,
        primaryPlantName: primaryPlant?.name ?? null,
        stage: grow.stage,
        startDate: grow.start_date,
        updatedAt: grow.updated_at,
      } satisfies GrowOverview;
    })
    .sort(compareUpdatedAtDescending);

  const recentFindings = findings.slice(0, 5).map((finding) => ({
    createdAt: finding.created_at,
    growId: finding.grow_id,
    id: finding.id,
    plantId: finding.plant_id,
    plantName: plantNamesById.get(finding.plant_id) ?? "Plant",
    severity: finding.severity,
    title: finding.title,
  }));

  return {
    grows: growOverview,
    openFindings: findings.filter((finding) => !finding.resolved_at).length,
    recentActivity: {
      lastCaptureAt: images[0]?.created_at ?? null,
      lastPlantUpdateAt: plants[0]?.updated_at ?? null,
    },
    recentFindings,
    totals: {
      grows: grows.length,
      images: images.length,
      plants: plants.length,
    },
  };
}
