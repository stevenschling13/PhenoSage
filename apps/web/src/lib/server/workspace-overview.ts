import "server-only";
import { createSupabaseServerClient } from "./auth";
import { logServerEvent } from "./request-id";

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

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    // Auth/cookie/env failure — log and render an empty board rather than
    // throwing the user into the global error boundary. Reference codes
    // surfaced by the boundary aren't actionable for this case.
    logServerEvent("error", "workspace overview client init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return EMPTY_WORKSPACE_OVERVIEW;
  }

  // Run all four queries independently so a missing table, RLS denial, or
  // transient network blip on one source degrades that source to "empty"
  // instead of taking down the entire dashboard view.
  const [growsSettled, plantsSettled, imagesSettled, findingsSettled] =
    await Promise.allSettled([
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

  function unwrap<T>(
    label: string,
    settled: PromiseSettledResult<{
      data: T[] | null;
      error: { message: string } | null;
    }>,
  ): T[] {
    if (settled.status === "rejected") {
      logServerEvent("error", "workspace overview query rejected", {
        source: label,
        error:
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason),
      });
      return [];
    }
    if (settled.value.error) {
      logServerEvent("error", "workspace overview query failed", {
        source: label,
        error: settled.value.error.message,
      });
      return [];
    }
    return settled.value.data ?? [];
  }

  const grows = unwrap<GrowRow>("grows", growsSettled);
  const plants = unwrap<PlantRow>("plants", plantsSettled);
  const images = unwrap<ImageRow>("plant_images", imagesSettled);
  const findings = unwrap<FindingRow>("plant_findings", findingsSettled);

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

  // Recent activity should reflect items that still need operator attention.
  // Including resolved findings here misleads the dashboard "open watch
  // items" surface, since the count badge filters by `resolved_at` but the
  // visible list previously did not.
  const recentFindings = findings
    .filter((finding) => !finding.resolved_at)
    .slice(0, 5)
    .map((finding) => ({
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
