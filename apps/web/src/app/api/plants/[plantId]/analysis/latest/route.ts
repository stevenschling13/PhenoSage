import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server/auth";
import { getLatestPlantAnalysis } from "@/lib/server/plants";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

// GET /api/plants/[plantId]/analysis/latest
// Returns the most recent AnalysisResponse for a plant.
// Proxied through Next.js — the browser never calls the analysis service directly.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 }),
      requestId,
    );
  }

  const { plantId } = await params;

  try {
    const analysis = await getLatestPlantAnalysis(plantId);
    if (!analysis) {
      return attachRequestId(
        NextResponse.json(
          { plantId, analysis: null, requestId },
          { status: 200 },
        ),
        requestId,
      );
    }

    return attachRequestId(
      NextResponse.json({ plantId, analysis, requestId }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "latest plant analysis fetch failed", {
      requestId,
      plantId,
      errorMessage: error instanceof Error ? error.message : "unknown_error",
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return attachRequestId(
      NextResponse.json(
        {
          error: "Failed to load latest analysis",
          requestId,
        },
        { status: 500 },
      ),
      requestId,
    );
  }
}
