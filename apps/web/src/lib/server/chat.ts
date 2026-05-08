import "server-only";
import { getDbClient } from "./db";

export type ChatRole = "user" | "assistant" | "system";

export type ChatThreadRow = {
  id: string;
  user_id: string;
  grow_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatMessageRow = {
  id: string;
  thread_id: string;
  role: ChatRole;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function getOrCreateThread(params: {
  userId: string;
  threadId?: string;
  growId?: string;
  title?: string;
}) {
  const db = getDbClient();

  if (params.threadId) {
    const { data, error } = await db
      .from("chat_threads")
      .select("*")
      .eq("id", params.threadId)
      .eq("user_id", params.userId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load chat thread: ${error.message}`);
    if (!data) return null;
    return data as ChatThreadRow;
  }

  const { data, error } = await db
    .from("chat_threads")
    .insert({
      user_id: params.userId,
      grow_id: params.growId ?? null,
      title: params.title ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create chat thread: ${error.message}`);
  return data as ChatThreadRow;
}

export async function appendChatMessage(params: {
  threadId: string;
  role: ChatRole;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDbClient();
  const { error } = await db.from("chat_messages").insert({
    thread_id: params.threadId,
    role: params.role,
    content: params.content,
    metadata: params.metadata ?? null,
  });
  if (error)
    throw new Error(`Failed to persist chat message: ${error.message}`);

  await db
    .from("chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", params.threadId);
}

export async function listThreadsForUser(userId: string) {
  const db = getDbClient();
  const { data, error } = await db
    .from("chat_threads")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Failed to list chat threads: ${error.message}`);
  return (data ?? []) as ChatThreadRow[];
}

export async function listMessagesForThread(params: {
  threadId: string;
  userId: string;
}) {
  const db = getDbClient();
  const { data: thread, error: threadError } = await db
    .from("chat_threads")
    .select("id")
    .eq("id", params.threadId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (threadError)
    throw new Error(`Failed to load chat thread: ${threadError.message}`);
  if (!thread) return null;

  const { data, error } = await db
    .from("chat_messages")
    .select("*")
    .eq("thread_id", params.threadId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`Failed to list chat messages: ${error.message}`);
  return (data ?? []) as ChatMessageRow[];
}
