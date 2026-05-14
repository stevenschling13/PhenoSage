import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  getServerSession,
} from "@/lib/server/auth";
import { getOrCreateQuickCapturePlant } from "@/lib/server/plants";
import { attachRequestId, getOrCreateRequestId } from "@/lib/server/request-id";

// POST /api/grows/[growId]/quick-capture-plant
// Returns the (auto-created if missing) "Quick captures" plant id for the
// given grow. Used by the chat composer when the user attaches an image
// without first picking a specific plant — every chat-uploaded image must
// land in a real plants row so the existing analysis + timeline pipelines
// can take it from there unmodified.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ growId: string }> },
) {
  const requestId = getOrCreateRequestId(request);
  const { growId } = await params;
  if (!growId) {
    return attachRequestId(
      NextResponse.json(
        { error: "growId is required.", requestId },
        { status: 400 },
      ),
      requestId,
    );
  }

  const session = await getServerSession();
  if (!session?.user) {
    return attachRequestId(
      NextResponse.json(
        { error: "You must be signed in.", requestId },
        { status: 401 },
      ),
      requestId,
    );
  }

  // Ownership check via the user-scoped client (RLS).
  const supabase = await createSupabaseServerClient();
  const { data: ownedGrow, error: ownershipError } = await supabase
    .from("grows")
    .select("id")
    .eq("id", growId)
    .maybeSingle();
  if (ownershipError) {
    return attachRequestId(
      NextResponse.json(
        { error: "Failed to verify grow access.", requestId },
        { status: 500 },
      ),
      requestId,
    );
  }
  if (!ownedGrow) {
    return attachRequestId(
      NextResponse.json(
        { error: "Grow not found.", requestId },
        { status: 404 },
      ),
      requestId,
    );
  }

  const result = await getOrCreateQuickCapturePlant({ growId });
  if (!result) {
    return attachRequestId(
      NextResponse.json(
        { error: "Could not create quick-capture plant.", requestId },
        { status: 500 },
      ),
      requestId,
    );
  }

  const res = NextResponse.json({ plantId: result.plantId, requestId });
  return attachRequestId(res, requestId);
}
