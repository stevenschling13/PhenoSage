import "server-only";
import { getDbClient } from "./db";

export interface GrowContextSnapshot {
  growId: string;
  strain: string | null;
  stage: string | null;
  medium: string | null;
  lightType: string | null;
  daysSinceStart: number | null;
  notes: string | null;
}

/**
 * Build a GrowContext snapshot for a plant by joining the grow + plant rows.
 * Uses service role — callers must have already authorized access.
 */
export async function loadGrowContext(
  plantId: string,
  growId: string,
): Promise<GrowContextSnapshot> {
  const db = getDbClient();

  const [plantRes, growRes] = await Promise.all([
    db.from("plants").select("strain, notes").eq("id", plantId).maybeSingle(),
    db
      .from("grows")
      .select("stage, medium, light_type, start_date")
      .eq("id", growId)
      .maybeSingle(),
  ]);

  const plant = plantRes.data as {
    strain: string | null;
    notes: string | null;
  } | null;
  const grow = growRes.data as {
    stage: string | null;
    medium: string | null;
    light_type: string | null;
    start_date: string | null;
  } | null;

  return {
    growId,
    strain: plant?.strain ?? null,
    stage: grow?.stage ?? null,
    medium: grow?.medium ?? null,
    lightType: grow?.light_type ?? null,
    daysSinceStart: grow?.start_date
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(grow.start_date).getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : null,
    notes: plant?.notes ?? null,
  };
}
