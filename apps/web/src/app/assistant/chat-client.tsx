"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SendIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  content: string;
}

const SUGGESTIONS = [
  "What's the most likely cause of yellowing on lower leaves?",
  "When should I switch this grow to flower?",
  "Summarize what changed in the last 7 days.",
];

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi — I'm your grow copilot. I can see your plants, timeline, and observations. Ask me anything about your grow, or pick a starter below.",
};

function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Web Crypto API unavailable");
  }
  const values = new Uint32Array(2);
  cryptoApi.getRandomValues(values);
  // Two uint32 values provide 64 bits of entropy; base-36 keeps this UI-only ID
  // compact and 7-character padding preserves fixed-width segments.
  return Array.from(values, (value) =>
    value.toString(36).padStart(7, "0"),
  ).join("");
}

export function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  // Cancel in-flight stream on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Ref-based guard: state-based `streaming` updates async, so rapid clicks
    // could otherwise enqueue concurrent streams.
    if (abortRef.current) return;
    setError(null);

    const userMsg: Message = { id: newId(), role: "user", content: trimmed };
    const assistantId = newId();
    setMessages((m) => [
      ...m,
      userMsg,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
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
      // Always drop an empty placeholder — whether the user stopped early or
      // the request errored before any content streamed. Preserve partial
      // replies the user already saw.
      setMessages((prev) =>
        prev.filter((m) => m.id !== assistantId || m.content.length > 0),
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, []);

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

  return (
    <>
      <div ref={scrollerRef} className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 lg:px-8">
          <div className="space-y-6">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} streaming={streaming} />
            ))}

            {showSuggestions && (
              <div className="ml-12 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {s}
                  </button>
                ))}
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
              placeholder="Ask about your grow…  (Enter to send, Shift+Enter for newline)"
              disabled={streaming}
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
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
            Replies are generated by AI. Verify before acting on plant-health
            advice.
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
          {isPending ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Dot delay="0ms" />
              <Dot delay="120ms" />
              <Dot delay="240ms" />
            </span>
          ) : (
            <span className="whitespace-pre-wrap break-words">
              {message.content}
            </span>
          )}
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
