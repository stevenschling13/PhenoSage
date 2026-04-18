import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server/auth";
import { getDbClient } from "@/lib/server/db";

interface RouteParams {
  params: { plantId: string };
}

// GET /api/plants/[plantId]/timeline
// Returns the ordered list of plant images + observations for a plant.
export async function GET(
  request: NextRequest,
  { params }: RouteParams,
) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { plantId } = params;
  const db = getDbClient();

  // TODO: Verify user has access to this plant via grow_members RLS
  // TODO: Query plant_images and plant_observations joined, ordered by takenAt/observedAt

  void db; // placeholder until wired

  return NextResponse.json({
    plantId,
    items: [],
    message: "TODO: Wire Supabase DB timeline query",
  });
}
