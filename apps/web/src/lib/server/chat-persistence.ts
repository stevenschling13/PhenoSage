import "server-only";
import { getDbClient } from "./db";
import { createSupabaseServerClient } from "./auth";
import { logServerEvent } from "./request-id";

// Persistence layer for chat threads + messages.
//
// Writes go through the service role client (chat_messages has no user-facing
// insert policy by design) but we authorize the user's ownership of the
// thread up-front before any write. Reads go through the user-scoped client
// so RLS still gates "show me my threads".

const TITLE_MAX_LENGTH = 80;

export type ChatThreadRow = {
  id: string;
  userId: string;
  growId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageRow = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

function deriveTitle(firstUserMessage: string): string {
  const single = firstUserMessage.replace(/\s+/g, " ").trim();
  if (single.length <= TITLE_MAX_LENGTH) return single;
  return `${single.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}

/** Confirms `threadId` belongs to `userId`. Uses service role to bypass RLS
 * because we already have the user id from the trusted session — we just
 * need the ownership check itself to run unconditionally. */
export async function assertThreadOwner(
  threadId: string,
  userId: string,
): Promise<boolean> {
  const db = getDbClient();
  const { data, error } = await db
    .from("chat_threads")
    .select("id,user_id")
    .eq("id", threadId)
    .maybeSingle();
  if (error || !data) return false;
  return (data as { user_id: string }).user_id === userId;
}

export async function createThread(params: {
  userId: string;
  growId: string | null;
  firstUserMessage: string;
}): Promise<string | null> {
  const db = getDbClient();
  const title = deriveTitle(params.firstUserMessage);
  const { data, error } = await db
    .from("chat_threads")
    .insert({
      user_id: params.userId,
      grow_id: params.growId,
      title,
    })
    .select("id")
    .single();
  if (error || !data) {
    logServerEvent("error", "chat thread create failed", {
      userId: params.userId,
      growId: params.growId,
      error: error?.message ?? "no row",
    });
    return null;
  }
  return (data as { id: string }).id;
}

export async function appendMessage(params: {
  threadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!params.content) return;
  const db = getDbClient();
  // The chat_messages.valid_metadata constraint requires the JSON object to
  // contain at least one of tokens / model / context. We don't try to write
  // metadata unless the caller provides a real value.
  const insertRow: Record<string, unknown> = {
    thread_id: params.threadId,
    role: params.role,
    content: params.content,
  };
  if (params.metadata && Object.keys(params.metadata).length > 0) {
    insertRow["metadata"] = params.metadata;
  }
  const { error } = await db.from("chat_messages").insert(insertRow);
  if (error) {
    logServerEvent("error", "chat message insert failed", {
      threadId: params.threadId,
      role: params.role,
      error: error.message,
    });
  }
}

export async function touchThread(threadId: string): Promise<void> {
  const db = getDbClient();
  const { error } = await db
    .from("chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId);
  if (error) {
    logServerEvent("error", "chat thread touch failed", {
      threadId,
      error: error.message,
    });
  }
}

export async function listThreadsForUser(): Promise<ChatThreadRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("chat_threads")
    .select("id,user_id,grow_id,title,created_at,updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) {
    logServerEvent("error", "chat threads list failed", {
      error: error.message,
    });
    return [];
  }
  return (
    (data ?? []) as Array<{
      id: string;
      user_id: string;
      grow_id: string | null;
      title: string | null;
      created_at: string;
      updated_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    userId: row.user_id,
    growId: row.grow_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getThreadMessages(
  threadId: string,
): Promise<ChatMessageRow[] | null> {
  const supabase = await createSupabaseServerClient();
  // RLS will return zero rows if the user does not own the thread; we also
  // check the thread row itself so we can distinguish "not yours" from "empty".
  const { data: thread, error: threadErr } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("id", threadId)
    .maybeSingle();
  if (threadErr || !thread) return null;

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id,thread_id,role,content,created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    logServerEvent("error", "chat messages fetch failed", {
      threadId,
      error: error.message,
    });
    return [];
  }
  return (
    (data ?? []) as Array<{
      id: string;
      thread_id: string;
      role: "user" | "assistant" | "system";
      content: string;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));
}

export async function deleteThreadForUser(threadId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  // RLS limits deletes to threads where auth.uid() = user_id, and the
  // chat_messages FK cascades on delete.
  const { error } = await supabase
    .from("chat_threads")
    .delete()
    .eq("id", threadId);
  if (error) {
    logServerEvent("error", "chat thread delete failed", {
      threadId,
      error: error.message,
    });
    return false;
  }
  return true;
}

export async function renameThreadForUser(
  threadId: string,
  title: string,
): Promise<boolean> {
  const trimmed = title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_LENGTH);
  if (!trimmed) return false;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("chat_threads")
    .update({ title: trimmed, updated_at: new Date().toISOString() })
    .eq("id", threadId);
  if (error) {
    logServerEvent("error", "chat thread rename failed", {
      threadId,
      error: error.message,
    });
    return false;
  }
  return true;
}
