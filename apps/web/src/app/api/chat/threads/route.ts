import { NextRequest, NextResponse } from "next/server";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { apiError } from "@/lib/server/api-errors";
import { getOrCreateThread, listThreadsForUser } from "@/lib/server/chat";
import { getOrCreateRequestId } from "@/lib/server/request-id";

export async function GET(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  const user = await getServerUser();
  if (!user) return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);

  const threads = await listThreadsForUser(user.id);
  return NextResponse.json({ threads });
}

export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  const user = await getServerUser();
  if (!user) return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);

  const body = (await request.json()) as { growId?: string; title?: string };
  const thread = await getOrCreateThread({
    userId: user.id,
    ...(body.growId ? { growId: body.growId } : {}),
    ...(body.title ? { title: body.title } : {}),
  });

  return NextResponse.json({ thread }, { status: 201 });
}
