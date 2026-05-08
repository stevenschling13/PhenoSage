import { NextRequest, NextResponse } from "next/server";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { getPlantTimeline, persistPlantImageUpload } from "@/lib/server/plants";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

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
    const timeline = await getPlantTimeline(plantId);
    if (!timeline) {
      return attachRequestId(
        NextResponse.json(
          { error: "Plant not found or access denied", requestId },
          { status: 404 },
        ),
        requestId,
      );
    }

    const images = timeline.items.filter((item) => item.type === "image");
    return attachRequestId(
      NextResponse.json({ plantId, images, requestId }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "plant image listing failed", {
      requestId,
      plantId,
      errorMessage: error instanceof Error ? error.message : "unknown_error",
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return attachRequestId(
      NextResponse.json(
        {
          error: "Failed to load plant images",
          requestId,
        },
        { status: 500 },
      ),
      requestId,
    );
  }
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
    limit: 10,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return attachRequestId(
      NextResponse.json(
        {
          error: "Too many upload preparations. Try again shortly.",
          requestId,
        },
        { status: 429 },
      ),
      requestId,
    );
  }

  const { plantId } = await params;
  const body = (await request.json()) as {
    imageId: string;
    takenAt?: string;
    source?: "camera" | "upload";
    notes?: string;
    storagePath: string;
  };

  if (!body.imageId || !body.storagePath) {
    return attachRequestId(
      NextResponse.json(
        { error: "imageId and storagePath are required", requestId },
        { status: 400 },
      ),
      requestId,
    );
  }

  try {
    const prepared = await persistPlantImageUpload({
      imageId: body.imageId,
      plantId,
      ...(body.takenAt ? { takenAt: body.takenAt } : {}),
      ...(body.source ? { source: body.source } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
      storagePath: body.storagePath,
    });

    if (!prepared) {
      return attachRequestId(
        NextResponse.json(
          { error: "Plant not found or access denied", requestId },
          { status: 404 },
        ),
        requestId,
      );
    }

    return attachRequestId(
      NextResponse.json({ ...prepared, requestId }, { status: 201 }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "plant image finalize failed", {
      requestId,
      plantId,
      errorMessage: error instanceof Error ? error.message : "unknown_error",
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return attachRequestId(
      NextResponse.json(
        {
          error: "Image persistence failed",
          requestId,
        },
        { status: 500 },
      ),
      requestId,
    );
  }
}
