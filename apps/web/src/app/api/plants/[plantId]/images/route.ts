import { NextRequest, NextResponse } from "next/server";
import { plantImageFinalizeRequestSchema } from "@phenosage/shared";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { getPlantTimeline, persistPlantImageUpload } from "@/lib/server/plants";
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
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return attachRequestId(
      NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to load plant images",
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
  const rate = await rateLimit({
    key: `images:${rateLimitKeyFromRequest(request, user?.id ?? null)}`,
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

  const parsed = await parseJson(request, plantImageFinalizeRequestSchema, {
    requestId,
  });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const { plantId } = await params;

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
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return attachRequestId(
      NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Image persistence failed",
          requestId,
        },
        { status: 500 },
      ),
      requestId,
    );
  }
}
