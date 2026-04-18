import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server/auth";
import { callAnalysisService } from "@/lib/server/analysis-proxy";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

// GET /api/plants/[plantId]/analysis/latest
// Returns the most recent AnalysisResponse for a plant.
// Proxied through Next.js — the browser never calls the analysis service directly.
export async function GET(
  request: NextRequest,
  { params }: RouteParams,
) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { plantId } = await params;

  // TODO: Look up the latest plant_image for this plant from DB
  // TODO: Call analysis service via proxy if a new image is pending
  // TODO: Return cached PlantFinding rows if analysis already ran

  void callAnalysisService({
    endpoint: `/plants/${plantId}/analysis/latest`,
    method: "GET",
  });

  return NextResponse.json({
    plantId,
    analysis: null,
    message: "TODO: Wire DB + analysis service proxy",
  });
}
