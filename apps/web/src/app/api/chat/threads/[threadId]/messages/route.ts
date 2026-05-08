import { NextRequest, NextResponse } from "next/server";
import { UuidSchema } from "@phenosage/shared";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { apiError } from "@/lib/server/api-errors";
import { listMessagesForThread } from "@/lib/server/chat";
import { getOrCreateRequestId } from "@/lib/server/request-id";

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(_request);
  const session = await getServerSession();
  if (!session) return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  const user = await getServerUser();
  if (!user) return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);

  const { threadId } = await params;
  if (!UuidSchema.safeParse(threadId).success) {
    return apiError(422, "UNPROCESSABLE_ENTITY", "Invalid threadId", requestId);
  }

  const messages = await listMessagesForThread({ threadId, userId: user.id });
  if (!messages)
    return apiError(404, "NOT_FOUND", "Chat thread not found", requestId);
  return NextResponse.json({ messages });
}
