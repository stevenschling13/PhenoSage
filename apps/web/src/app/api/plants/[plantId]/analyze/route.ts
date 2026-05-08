import { NextRequest, NextResponse } from "next/server";
import { analyzeRequestSchema } from "@phenosage/shared";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { runAndPersistPlantAnalysis } from "@/lib/server/plants";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";
import { parseJson } from "@/lib/server/validate";

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
    key: `analyze:${rateLimitKeyFromRequest(request, user?.id ?? null)}`,
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

  const parsed = await parseJson(request, analyzeRequestSchema, { requestId });
  if (!parsed.ok) return parsed.response;
  const { imageId } = parsed.data;

  const { plantId } = await params;

  try {
    const result = await runAndPersistPlantAnalysis({
      plantId,
      ...(imageId ? { imageId } : {}),
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
      imageId,
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
