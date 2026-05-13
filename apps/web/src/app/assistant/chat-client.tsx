"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SendIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { renderMarkdown } from "./markdown";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  content: string;
}

type PromptCategory = {
  label: string;
  prompts: string[];
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
    "I'm your cultivation copilot — environment, nutrition, IPM, training, harvest. I can read your grow data via tools and ground advice in what's actually happening in your tent. Pick a category below or ask anything specific.",
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

export function AssistantChat() {
  const searchParams = useSearchParams();
  const growId = searchParams?.get("growId") ?? null;
  const plantId = searchParams?.get("plantId") ?? null;

  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(
    PROMPT_CATEGORIES[0]?.label ?? "",
  );

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

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (abortRef.current) return;
      setError(null);

      const userMsg: Message = { id: newId(), role: "user", content: trimmed };
      const assistantId = newId();

      // Snapshot history BEFORE we append the new user message, so the
      // server-side prompt sees prior turns and then the new user content
      // injected as the canonical final user message.
      let historyToSend: Array<{ role: Role; content: string }> = [];
      setMessages((m) => {
        // Exclude the welcome bubble + drop the assistant placeholder we're
        // about to add. Cap at MAX_HISTORY to keep payloads bounded.
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
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            history: historyToSend,
            growId,
            plantId,
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
    [growId, plantId],
  );

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

  return (
    <>
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
            className="flex items-end gap-2 rounded-lg border border-input bg-background p-2 shadow-elevation-1 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40"
            aria-label="Send message"
          >
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
              placeholder="Ask about your grow — symptoms, EC, training, IPM…  (Enter to send, Shift+Enter for newline)"
              disabled={streaming}
              className="max-h-48 min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
            {streaming ? (
              <Button type="button" variant="outline" size="md" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                size="md"
                disabled={!input.trim()}
                rightIcon={<SendIcon width={14} height={14} />}
              >
                Send
              </Button>
            )}
          </form>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Replies are generated by AI grounded in your grow data. Verify
            numeric targets before acting on plant-health advice.
          </p>
        </div>
      </div>
    </>
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
      <span className="whitespace-pre-wrap break-words">{message.content}</span>
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
