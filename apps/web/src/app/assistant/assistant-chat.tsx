"use client";

import { useCallback, useRef, useState } from "react";

interface GrowOption {
  id: string;
  name: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface Props {
  grows: GrowOption[];
}

export function AssistantChat({ grows }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [growId, setGrowId] = useState<string>(grows[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);

    const localUser: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, localUser]);
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          threadId: threadId ?? undefined,
          growId: threadId ? undefined : growId || undefined,
        }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) detail = j.error;
        } catch {
          // ignore json parse error
        }
        setError(detail);
        return;
      }
      const data = (await res.json()) as {
        threadId: string;
        message: ChatMessage;
      };
      setThreadId(data.threadId);
      setMessages((prev) => [...prev, data.message]);
      setTimeout(
        () => endRef.current?.scrollIntoView({ behavior: "smooth" }),
        0,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [busy, input, threadId, growId]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send();
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 ? (
            <div className="flex gap-3">
              <Avatar role="assistant" />
              <Bubble role="assistant">
                Hello! I&apos;m your grow copilot.
                {grows.length > 0
                  ? " Pick a grow below and ask me anything about it."
                  : " You don't have any grows linked yet, so I can only answer general questions."}
              </Bubble>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}
              >
                {m.role === "assistant" ? <Avatar role="assistant" /> : null}
                <Bubble role={m.role}>{m.content}</Bubble>
                {m.role === "user" ? <Avatar role="user" /> : null}
              </div>
            ))
          )}
          {busy ? (
            <div className="flex gap-3">
              <Avatar role="assistant" />
              <Bubble role="assistant">Thinking…</Bubble>
            </div>
          ) : null}
          {error ? (
            <p className="text-center text-xs text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <div ref={endRef} />
        </div>
      </div>

      <form onSubmit={onSubmit} className="border-t bg-white px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {grows.length > 0 && !threadId ? (
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Grounded in:
              <select
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
                value={growId}
                onChange={(e) => setGrowId(e.target.value)}
                disabled={busy}
              >
                <option value="">No grow (general advice)</option>
                {grows.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your grow…"
              className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              disabled={busy}
            />
            <button
              type="submit"
              className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              disabled={busy || !input.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  if (role === "assistant") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-600">
        AI
      </div>
    );
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600">
      You
    </div>
  );
}

function Bubble({
  role,
  children,
}: {
  role: "user" | "assistant";
  children: React.ReactNode;
}) {
  const base = "whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm max-w-lg";
  if (role === "assistant") {
    return (
      <div className={`${base} rounded-tl-none border bg-white text-gray-700`}>
        {children}
      </div>
    );
  }
  return (
    <div className={`${base} rounded-tr-none bg-brand-600 text-white`}>
      {children}
    </div>
  );
}
