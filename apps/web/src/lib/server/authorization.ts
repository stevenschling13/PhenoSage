import "server-only";
import { getDbClient } from "./db";

export interface PlantAccess {
  plantId: string;
  growId: string;
  strain: string | null;
  name: string;
}

export interface GrowAccess {
  growId: string;
  ownerId: string;
  role: "owner" | "collaborator" | "viewer";
  name: string;
  stage: string;
  medium: string;
  lightType: string;
  startDate: string;
  strain: string | null;
}

/**
 * Verify the user can access a plant (owner or grow member).
 * Returns null when the plant doesn't exist or the user has no access.
 * Uses service role to resolve plant→grow, then checks membership explicitly.
 */
export async function authorizePlantAccess(
  userId: string,
  plantId: string,
): Promise<PlantAccess | null> {
  if (!isLikelyUuid(plantId)) return null;
  const db = getDbClient();

  const { data: plant, error } = await db
    .from("plants")
    .select("id, grow_id, strain, name")
    .eq("id", plantId)
    .maybeSingle();

  if (error || !plant) return null;

  const growId = plant.grow_id as string;
  const ok = await userCanReadGrow(userId, growId);
  if (!ok) return null;

  return {
    plantId: plant.id as string,
    growId,
    strain: (plant.strain as string | null) ?? null,
    name: (plant.name as string) ?? "",
  };
}

export async function authorizeGrowAccess(
  userId: string,
  growId: string,
): Promise<GrowAccess | null> {
  if (!isLikelyUuid(growId)) return null;
  const db = getDbClient();

  const { data: grow, error } = await db
    .from("grows")
    .select(
      "id, owner_id, name, stage, medium, light_type, start_date, description",
    )
    .eq("id", growId)
    .maybeSingle();

  if (error || !grow) return null;

  const isOwner = grow.owner_id === userId;
  let role: "owner" | "collaborator" | "viewer" | null = isOwner
    ? "owner"
    : null;

  if (!isOwner) {
    const { data: member } = await db
      .from("grow_members")
      .select("role")
      .eq("grow_id", growId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) return null;
    role = (member.role as "collaborator" | "viewer") ?? "viewer";
  }

  return {
    growId: grow.id as string,
    ownerId: grow.owner_id as string,
    role: role ?? "viewer",
    name: grow.name as string,
    stage: grow.stage as string,
    medium: grow.medium as string,
    lightType: grow.light_type as string,
    startDate: grow.start_date as string,
    strain: null,
  };
}

async function userCanReadGrow(
  userId: string,
  growId: string,
): Promise<boolean> {
  const db = getDbClient();
  const { data: grow } = await db
    .from("grows")
    .select("owner_id")
    .eq("id", growId)
    .maybeSingle();
  if (!grow) return false;
  if (grow.owner_id === userId) return true;

  const { data: member } = await db
    .from("grow_members")
    .select("user_id")
    .eq("grow_id", growId)
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(member);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLikelyUuid(v: string): boolean {
  return typeof v === "string" && UUID_RE.test(v);
}
