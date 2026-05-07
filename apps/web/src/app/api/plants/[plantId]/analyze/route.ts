import { NextRequest, NextResponse } from "next/server";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { runAndPersistPlantAnalysis } from "@/lib/server/plants";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 }),
      requestId,
    );
  }

  const user = await getServerUser();
  const rate = rateLimit({
    key: rateLimitKeyFromRequest(request, user?.id ?? null),
    limit: 5,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return attachRequestId(
      NextResponse.json(
        {
          error: "Too many analysis requests. Try again shortly.",
          requestId,
        },
        { status: 429 },
      ),
      requestId,
    );
  }

  const { plantId } = await params;
  const body = (await request.json().catch(() => ({}))) as { imageId?: string };

  try {
    const result = await runAndPersistPlantAnalysis({
      plantId,
      ...(body.imageId ? { imageId: body.imageId } : {}),
      requestId,
    });

    if (!result) {
      return attachRequestId(
        NextResponse.json(
          { error: "Plant not found or access denied", requestId },
          { status: 404 },
        ),
        requestId,
      );
    }

    if (!result.analysis) {
      return attachRequestId(
        NextResponse.json(
          { error: "No plant images are available to analyze", requestId },
          { status: 404 },
        ),
        requestId,
      );
    }

    return attachRequestId(
      NextResponse.json({ analysis: result.analysis, requestId }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "plant analysis failed", {
      requestId,
      plantId,
      imageId: body.imageId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return attachRequestId(
      NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Plant analysis failed",
          requestId,
        },
        { status: 500 },
      ),
      requestId,
    );
  }
}
