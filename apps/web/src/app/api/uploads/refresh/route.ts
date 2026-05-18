import { NextRequest, NextResponse } from "next/server";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { signPlantImageUrl } from "@/lib/server/plants";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";
import { withRouteLogging } from "@/lib/server/route-logging";

/**
 * POST /api/uploads/refresh
 *
 * Re-sign a Supabase Storage download URL for a previously-uploaded
 * plant image. Used by `<SignedImage>` on the client when the original
 * signed URL (rendered into the page at SSR time) expires before the
 * user finishes interacting with the page.
 *
 * Body: `{ plantId: string, imageId: string, expiresInSeconds?: number }`
 * Returns: `{ signedUrl, expiresAt, requestId }` on success.
 *
 * Auth: requires a session, and `signPlantImageUrl` re-verifies the
 * caller actually owns the plant *and* the image belongs to that plant
 * — passing an image id for a plant the caller doesn't own returns 404,
 * never a fresh URL.
 *
 * Rate limit: same per-user budget as `/api/uploads/sign` because the
 * cost profile (one Supabase signing round-trip) is identical.
 */
export const POST = withRouteLogging(
  "/api/uploads/refresh",
  async (request: NextRequest) => {
    const requestId = getOrCreateRequestId(request);
    const session = await getServerSession();
    if (!session) {
      return attachRequestId(
        NextResponse.json(
          { error: "Unauthorized", requestId },
          { status: 401 },
        ),
        requestId,
      );
    }

    const user = await getServerUser();
    const rate = await rateLimit({
      key: rateLimitKeyFromRequest(request, user?.id ?? null),
      limit: 30,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      return attachRequestId(
        NextResponse.json(
          {
            error: "Too many image refresh requests. Try again shortly.",
            requestId,
          },
          { status: 429 },
        ),
        requestId,
      );
    }

    let body: {
      plantId?: unknown;
      imageId?: unknown;
      expiresInSeconds?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return attachRequestId(
        NextResponse.json(
          { error: "Request body must be valid JSON.", requestId },
          { status: 400 },
        ),
        requestId,
      );
    }
    // `request.json()` succeeds for primitives (`null`, numbers, strings)
    // and arrays — none of which carry the named fields we expect. Reject
    // them here so the field-access checks below can rely on `body` being
    // an actual object, instead of throwing a TypeError → unhandled 500.
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return attachRequestId(
        NextResponse.json(
          { error: "Request body must be a JSON object.", requestId },
          { status: 400 },
        ),
        requestId,
      );
    }

    // Narrow validation here (instead of zod) keeps the route handler
    // self-contained and matches the style of the sibling /sign route.
    // Both ids are UUIDs in our schema; we don't enforce the full UUID
    // shape because Postgres will reject malformed ids on the lookup
    // anyway and the auth check will short-circuit to null/404.
    if (typeof body.plantId !== "string" || body.plantId.length === 0) {
      return attachRequestId(
        NextResponse.json(
          { error: "plantId is required.", requestId },
          { status: 400 },
        ),
        requestId,
      );
    }
    if (typeof body.imageId !== "string" || body.imageId.length === 0) {
      return attachRequestId(
        NextResponse.json(
          { error: "imageId is required.", requestId },
          { status: 400 },
        ),
        requestId,
      );
    }
    // The TTL is optional; the helper clamps to [60, 3600] so a bad value
    // here is harmless. Anything non-numeric just falls through to the
    // helper's default.
    const expiresInSeconds =
      typeof body.expiresInSeconds === "number" &&
      Number.isFinite(body.expiresInSeconds)
        ? body.expiresInSeconds
        : undefined;

    try {
      const signed = await signPlantImageUrl({
        plantId: body.plantId,
        imageId: body.imageId,
        ...(expiresInSeconds !== undefined ? { expiresInSeconds } : {}),
      });
      if (!signed) {
        // Auth failure and missing image collapse into one 404 so an
        // unauthorised caller cannot probe image-id existence.
        return attachRequestId(
          NextResponse.json(
            { error: "Image not found or access denied.", requestId },
            { status: 404 },
          ),
          requestId,
        );
      }
      return attachRequestId(
        NextResponse.json({
          signedUrl: signed.signedUrl,
          expiresAt: signed.expiresAt,
          requestId,
        }),
        requestId,
      );
    } catch (error) {
      logServerEvent("error", "signed url refresh failed", {
        requestId,
        plantId: body.plantId,
        imageId: body.imageId,
        error: error instanceof Error ? error.message : "unknown_error",
      });
      return attachRequestId(
        NextResponse.json(
          { error: "Failed to refresh image URL.", requestId },
          { status: 500 },
        ),
        requestId,
      );
    }
  },
);
