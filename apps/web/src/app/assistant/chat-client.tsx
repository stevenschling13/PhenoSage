"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SendIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { renderMarkdown } from "./markdown";

type Role = "user" | "assistant";

type ChatAttachment = {
  id?: string;
  kind: "image";
  plantId: string;
  imageId: string;
  storagePath: string;
};

interface Message {
  id: string;
  role: Role;
  content: string;
  attachments?: ChatAttachment[];
}

type PromptCategory = {
  label: string;
  prompts: string[];
};

export type GrowOption = {
  id: string;
  name: string;
  stage: string | null;
};

type ThreadSummary = {
  id: string;
  title: string | null;
  growId: string | null;
  updatedAt: string;
};

const PROMPT_CATEGORIES: PromptCategory[] = [
  {
    label: "Diagnose",
    prompts: [
      "Yellowing started on the lower leaves and is creeping up. Walk me through the diagnosis.",
      "I see clawing on the new growth tips. What am I looking at, and what would confirm it?",
      "Brown spots with yellow halos showing up on a few fan leaves. Pathogen or deficiency?",
    ],
  },
  {
    label: "Environment",
    prompts: [
      "What VPD, PPFD, and RH should I be targeting at my current stage?",
      "My night-time temp is dropping into the high 50s°F. How worried should I be and what should I change?",
      "How do I tune defoliation and airflow to lower botrytis risk in late flower?",
    ],
  },
  {
    label: "Feeding",
    prompts: [
      "Recommend an EC schedule for the next two weeks given my medium and stage.",
      "Runoff pH is drifting up. How do I bring it back without shocking the plants?",
      "Am I dialing in cal-mag correctly? What signs tell me I'm over- or under-feeding it?",
    ],
  },
  {
    label: "Training",
    prompts: [
      "Should I top, FIM, or move straight to LST given where my plants are now?",
      "How aggressive should my defoliation be at day 21 of flower?",
      "Build me a SCROG fill plan for the next 10 days.",
    ],
  },
  {
    label: "Flowering",
    prompts: [
      "When should I flip to 12/12 and what should change in the room when I do?",
      "How do I read trichomes to time the harvest window?",
      "Walk me through a proper dry and cure for my current setup.",
    ],
  },
  {
    label: "IPM",
    prompts: [
      "Tiny webs near the tops and stippled leaves — confirm or rule out spider mites.",
      "What's a stage-appropriate rotation for preventative IPM in veg?",
      "I think fungus gnats. How do I confirm and what's the fastest safe knockdown?",
    ],
  },
];

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "I'm your cultivation copilot — environment, nutrition, IPM, training, harvest. Pick a grow above to scope my answers to your data, or ask anything specific.",
};

function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  if (!cryptoApi?.getRandomValues) {
    throw new Error(
      "Browser does not support Web Crypto API secure random generation",
    );
  }
  const values = new Uint32Array(2);
  cryptoApi.getRandomValues(values);
  return Array.from(values, (value) =>
    value.toString(36).padStart(7, "0"),
  ).join("");
}

const MAX_HISTORY = 24;

export function AssistantChat({ grows }: { grows: GrowOption[] }) {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(
    PROMPT_CATEGORIES[0]?.label ?? "",
  );
  const [growId, setGrowId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  // Image upload state. We support a single pending attachment per turn
  // (server enforces the same limit for the inline analysis path); the
  // resolved plant id is sticky across the thread so the user only has
  // to pick a target plant on the FIRST attachment of a thread.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [threadPlantId, setThreadPlantId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const refreshThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const res = await fetch("/api/chat/threads");
      if (!res.ok) return;
      const data = (await res.json()) as {
        threads?: Array<{
          id: string;
          title: string | null;
          growId: string | null;
          updatedAt: string;
        }>;
      };
      setThreads(data.threads ?? []);
    } catch {
      /* ignore */
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => {
    // The sidebar's initial thread list is loaded on mount; the setState
    // calls inside refreshThreads only fire after the fetch resolves, so the
    // cascading-render risk this rule guards against doesn't apply here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshThreads();
  }, [refreshThreads]);

  const startNewThread = useCallback(() => {
    setThreadId(null);
    setMessages([WELCOME]);
    setError(null);
    setPendingFile(null);
    setThreadPlantId(null);
  }, []);

  const loadThread = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/chat/threads/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("Thread no longer exists.");
        } else {
          setError(`Failed to load thread (${res.status}).`);
        }
        return;
      }
      const data = (await res.json()) as {
        messages: Array<{
          id: string;
          role: Role;
          content: string;
          attachments?: Array<{
            id?: string;
            kind: string;
            plantId: string;
            imageId: string;
            storagePath: string;
          }>;
        }>;
      };
      const loaded: Message[] = (data.messages ?? [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          attachments: (m.attachments ?? [])
            .filter((a) => a.kind === "image")
            .map((a) => {
              const att: ChatAttachment = {
                kind: "image",
                plantId: a.plantId,
                imageId: a.imageId,
                storagePath: a.storagePath,
              };
              if (a.id) att.id = a.id;
              return att;
            }),
        }));
      setMessages(loaded.length > 0 ? loaded : [WELCOME]);
      setThreadId(id);
      // Reset attachment selection when switching threads — last thread's
      // selected plant should not bleed into the new one.
      setPendingFile(null);
      setThreadPlantId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load thread.");
    }
  }, []);

  const deleteThread = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/chat/threads/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          setError(`Failed to delete (${res.status}).`);
          return;
        }
        // If the user deleted the currently-open thread, reset the UI.
        if (id === threadId) startNewThread();
        void refreshThreads();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete.");
      }
    },
    [refreshThreads, startNewThread, threadId],
  );

  // Resolves the plant id to attach images to. Sticky per thread: once
  // resolved (either via the user picking a specific plant or the
  // auto-created "Quick captures" inbox for the active grow) we reuse it
  // for subsequent attachments in the same thread.
  const resolveAttachmentPlantId = useCallback(async (): Promise<
    string | null
  > => {
    if (threadPlantId) return threadPlantId;
    if (!growId) {
      setError(
        "Pick a grow before attaching an image — uploads are organized per grow.",
      );
      return null;
    }
    try {
      const res = await fetch(
        `/api/grows/${encodeURIComponent(growId)}/quick-capture-plant`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(
          data.error || `Failed to prepare plant for upload (${res.status}).`,
        );
        return null;
      }
      const data = (await res.json()) as { plantId?: string };
      if (!data.plantId) {
        setError("Server did not return a plant id for the upload.");
        return null;
      }
      setThreadPlantId(data.plantId);
      return data.plantId;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to prepare attachment.",
      );
      return null;
    }
  }, [growId, threadPlantId]);

  const uploadPendingAttachment = useCallback(
    async (file: File): Promise<ChatAttachment | null> => {
      const plantId = await resolveAttachmentPlantId();
      if (!plantId) return null;

      setAttachmentUploading(true);
      try {
        const signRes = await fetch("/api/upload/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plantId,
            fileName: file.name,
            contentType: file.type || "image/jpeg",
            chatThreadId: threadId,
          }),
        });
        const signPayload = (await signRes.json()) as {
          data?: {
            imageId?: string;
            storagePath?: string;
            token?: string;
          };
          error?: string;
          reason?: string;
        };
        if (!signRes.ok) {
          if (signPayload.reason === "video_unsupported") {
            setError("Video uploads aren't supported yet — try an image.");
          } else {
            setError(signPayload.error || "Failed to prepare upload.");
          }
          return null;
        }
        const signed = signPayload.data ?? {};
        if (!signed.storagePath || !signed.token || !signed.imageId) {
          setError("Upload signing did not return the required fields.");
          return null;
        }

        const supabase = createSupabaseBrowserClient();
        const { error: uploadError } = await supabase.storage
          .from("plant-images")
          .uploadToSignedUrl(signed.storagePath, signed.token, file, {
            contentType: file.type || "image/jpeg",
          });
        if (uploadError) {
          setError(uploadError.message);
          return null;
        }

        // Persist the plant_images row so the existing analysis +
        // timeline pipelines can find it.
        const persistRes = await fetch("/api/upload/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageId: signed.imageId,
            plantId,
            storagePath: signed.storagePath,
            source: "upload",
          }),
        });
        if (!persistRes.ok) {
          const data = (await persistRes.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(data.error || "Failed to record uploaded image.");
          return null;
        }

        return {
          kind: "image",
          plantId,
          imageId: signed.imageId,
          storagePath: signed.storagePath,
        };
      } finally {
        setAttachmentUploading(false);
      }
    },
    [resolveAttachmentPlantId, threadId],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const hasFile = pendingFile !== null;
      // Either text or a file is required — server allows the file-only
      // case and synthesizes a default prompt.
      if (!trimmed && !hasFile) return;
      // Two-phase guard against double-click / double-submit races:
      // 1. abortRef catches the case where the previous fetch hasn't yet
      //    finished and the user clicks Send (or Enter) again.
      // 2. We claim the abortRef BEFORE setMessages / fetch so a second
      //    near-simultaneous click sees the claim and bails — previously
      //    the guard relied on streaming state which is async and gives a
      //    short race window where two fetches could fire.
      if (abortRef.current) return;
      if (attachmentUploading) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);

      // If there's a pending file we have to upload it BEFORE we POST to
      // /api/chat — the chat route consumes attachment refs and runs
      // analysis inline. We deliberately do this before any UI state
      // mutation so an upload failure leaves the composer intact for
      // retry.
      let uploadedAttachment: ChatAttachment | null = null;
      if (pendingFile) {
        uploadedAttachment = await uploadPendingAttachment(pendingFile);
        if (!uploadedAttachment) {
          abortRef.current = null;
          return;
        }
      }

      const displayText =
        trimmed ||
        "Please analyze this plant image and tell me what you see, including changes from prior images.";
      const attachments: ChatAttachment[] = uploadedAttachment
        ? [uploadedAttachment]
        : [];
      const userMsg: Message = {
        id: newId(),
        role: "user",
        content: displayText,
        attachments,
      };
      const assistantId = newId();

      let historyToSend: Array<{ role: Role; content: string }> = [];
      setMessages((m) => {
        historyToSend = m
          .filter((x) => x.id !== "welcome")
          .slice(-MAX_HISTORY)
          .map((x) => ({ role: x.role, content: x.content }));
        return [
          ...m,
          userMsg,
          { id: assistantId, role: "assistant", content: "" },
        ];
      });
      setInput("");
      setPendingFile(null);
      setStreaming(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            history: historyToSend,
            growId,
            threadId,
            attachments: attachments.map((a) => ({
              kind: a.kind,
              plantId: a.plantId,
              imageId: a.imageId,
              storagePath: a.storagePath,
            })),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let detail = `Request failed with ${res.status}.`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data?.error) detail = data.error;
          } catch {
            /* ignore */
          }
          throw new Error(detail);
        }

        // Capture the thread id the server created (or echoed back).
        const newThreadId = res.headers.get("X-Chat-Thread-Id");
        if (newThreadId && newThreadId !== threadId) setThreadId(newThreadId);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();
          const chunk = decoder.decode(value, { stream: !done });
          if (chunk) {
            buffer += chunk;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: buffer } : m,
              ),
            );
          }
          if (done) break;
        }

        // Refresh the sidebar so the new / updated thread floats to the top.
        void refreshThreads();
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        const message = aborted
          ? null
          : err instanceof Error
            ? err.message
            : "Something went wrong.";
        if (message) setError(message);
        setMessages((prev) =>
          prev.filter((m) => m.id !== assistantId || m.content.length > 0),
        );
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [
      attachmentUploading,
      growId,
      pendingFile,
      refreshThreads,
      threadId,
      uploadPendingAttachment,
    ],
  );

  const onFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    if (file.type.startsWith("video/")) {
      setError("Video uploads aren't supported yet — try an image.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Only image files can be attached right now.");
      return;
    }
    setPendingFile(file);
    setError(null);
    // Allow re-selecting the same file later (browsers don't fire change
    // for an unchanged value).
    e.target.value = "";
  };

  const onDragEnter = (e: DragEvent<HTMLFormElement>) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      setDragActive(true);
    }
  };
  const onDragLeave = (e: DragEvent<HTMLFormElement>) => {
    if (e.currentTarget === e.target) setDragActive(false);
  };
  const onDragOver = (e: DragEvent<HTMLFormElement>) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  };
  const onDrop = (e: DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.type.startsWith("video/")) {
      setError("Video uploads aren't supported yet — try an image.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Only image files can be attached right now.");
      return;
    }
    setPendingFile(file);
    setError(null);
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const stop = () => abortRef.current?.abort();

  const showSuggestions = useMemo(
    () => messages.length === 1 && !streaming,
    [messages.length, streaming],
  );

  const activePrompts =
    PROMPT_CATEGORIES.find((c) => c.label === activeCategory)?.prompts ?? [];

  const activeGrow = grows.find((g) => g.id === growId) ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="border-b border-border p-3">
          <Button
            type="button"
            variant="outline"
            size="md"
            className="w-full"
            onClick={startNewThread}
          >
            + New chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {threadsLoading && threads.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Loading…</p>
          ) : threads.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              No saved chats yet. Ask a question and it&apos;ll appear here.
            </p>
          ) : (
            <ul className="space-y-1">
              {threads.map((t) => {
                const isActive = t.id === threadId;
                return (
                  <li key={t.id}>
                    <div
                      className={cn(
                        "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition",
                        isActive
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => void loadThread(t.id)}
                        className="flex-1 truncate text-left focus:outline-none"
                        title={t.title ?? "Untitled chat"}
                      >
                        {t.title ?? "Untitled chat"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteThread(t.id)}
                        aria-label={`Delete chat ${t.title ?? ""}`}
                        className="opacity-0 transition group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/60 px-5 py-2 sm:px-6 lg:px-8">
          <label
            htmlFor="grow-picker"
            className="text-xs font-medium text-muted-foreground"
          >
            Grow context
          </label>
          <select
            id="grow-picker"
            value={growId ?? ""}
            onChange={(e) => setGrowId(e.target.value || null)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="">Any grow (ask me to pick one)</option>
            {grows.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.stage ? ` · ${g.stage}` : ""}
              </option>
            ))}
          </select>
          {activeGrow && (
            <span className="text-[11px] text-muted-foreground">
              Replies will use {activeGrow.name}&apos;s data.
            </span>
          )}

          {/* Mobile thread picker — desktop has the sidebar; phones get
              a select + new-chat button right next to the grow picker so
              users on small screens can still switch / start threads. */}
          <div className="ml-auto flex items-center gap-2 md:hidden">
            <label htmlFor="thread-picker-mobile" className="sr-only">
              Chat thread
            </label>
            <select
              id="thread-picker-mobile"
              value={threadId ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) {
                  startNewThread();
                } else {
                  void loadThread(id);
                }
              }}
              className="h-8 max-w-[10rem] truncate rounded-md border border-input bg-background px-2 text-xs text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="">+ New chat</option>
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title ?? "Untitled chat"}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div ref={scrollerRef} className="flex-1 overflow-y-auto bg-background">
          <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 lg:px-8">
            <div className="space-y-6">
              {messages.map((m) => (
                <ChatBubble key={m.id} message={m} streaming={streaming} />
              ))}

              {showSuggestions && (
                <div className="ml-12 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {PROMPT_CATEGORIES.map((c) => {
                      const active = c.label === activeCategory;
                      return (
                        <button
                          key={c.label}
                          type="button"
                          onClick={() => setActiveCategory(c.label)}
                          className={cn(
                            "rounded-full px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "border border-border bg-card text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activePrompts.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void send(s)}
                        className="max-w-full rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="ml-12 max-w-xl rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-border bg-card">
          <div className="mx-auto w-full max-w-3xl px-5 py-4 sm:px-6 lg:px-8">
            <form
              onSubmit={onSubmit}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={onDrop}
              className={cn(
                "flex flex-col gap-2 rounded-lg border border-input bg-background p-2 shadow-elevation-1 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40",
                dragActive && "border-primary ring-2 ring-primary/40",
              )}
              aria-label="Send message"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                className="sr-only"
                onChange={onFileSelected}
                aria-label="Attach a plant image"
              />
              {pendingFile && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">
                  <span aria-hidden>📷</span>
                  <span
                    className="truncate font-medium"
                    title={pendingFile.name}
                  >
                    {pendingFile.name}
                  </span>
                  <span className="text-muted-foreground">
                    {(pendingFile.size / 1024).toFixed(0)} KB
                  </span>
                  {attachmentUploading && (
                    <span className="text-muted-foreground">uploading…</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingFile(null)}
                    aria-label="Remove attachment"
                    disabled={attachmentUploading || streaming}
                    className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    ×
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={streaming || attachmentUploading}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  aria-label="Attach an image"
                  title={
                    growId
                      ? "Attach a plant image"
                      : "Pick a grow first to attach an image"
                  }
                >
                  <span className="text-lg leading-none">📎</span>
                </button>
                <label htmlFor="composer" className="sr-only">
                  Ask the copilot
                </label>
                <textarea
                  ref={textareaRef}
                  id="composer"
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  maxLength={4000}
                  placeholder={
                    pendingFile
                      ? "Add an optional note about the image…"
                      : "Ask about your grow — symptoms, EC, training, IPM…  (Enter to send, Shift+Enter for newline). Drag in an image to analyze it."
                  }
                  disabled={streaming}
                  className="max-h-48 min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
                {streaming ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={stop}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="md"
                    disabled={
                      attachmentUploading || (!input.trim() && !pendingFile)
                    }
                    rightIcon={<SendIcon width={14} height={14} />}
                  >
                    Send
                  </Button>
                )}
              </div>
            </form>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Replies are generated by AI grounded in your grow data. Verify
              numeric targets before acting on plant-health advice.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  streaming,
}: {
  message: Message;
  streaming: boolean;
}) {
  const isUser = message.role === "user";
  const isPending = !isUser && streaming && message.content.length === 0;
  let rendered: ReactNode;
  if (isPending) {
    rendered = (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Dot delay="0ms" />
        <Dot delay="120ms" />
        <Dot delay="240ms" />
      </span>
    );
  } else if (isUser) {
    rendered = (
      <div className="space-y-2">
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.attachments.map((a, idx) => (
              <span
                key={a.id ?? `${a.imageId}-${idx}`}
                className="inline-flex items-center gap-1 rounded-md bg-primary/20 px-2 py-0.5 text-[11px] font-medium text-primary-foreground/90"
                title={`Image ${a.imageId}`}
              >
                <span aria-hidden>📷</span> image attached
              </span>
            ))}
          </div>
        )}
        <span className="whitespace-pre-wrap break-words">
          {message.content}
        </span>
      </div>
    );
  } else {
    rendered = (
      <div className="prose-chat break-words">
        {renderMarkdown(message.content)}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex gap-3 animate-fade-in-up",
        isUser && "flex-row-reverse",
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-primary/15 text-primary",
        )}
      >
        {isUser ? "You" : "AI"}
      </div>
      <Card className={cn("max-w-xl", isUser && "bg-accent")}>
        <CardContent className="p-4 text-sm leading-relaxed">
          {rendered}
        </CardContent>
      </Card>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-current"
      style={{ animationDelay: delay }}
    />
  );
}
