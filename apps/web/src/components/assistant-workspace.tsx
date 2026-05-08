"use client";

import { useMemo, useState } from "react";
import {
  ActivityIcon,
  AlertIcon,
  AnalysisIcon,
  AssistantIcon,
  CheckCircleIcon,
  SparkIcon,
  TimelineIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/cn";

type WorkspaceMessage = {
  content: string;
  id: string;
  role: "assistant" | "user";
  status?: "complete" | "streaming";
};

const initialMessages: WorkspaceMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    status: "complete",
    content:
      "I am PhenoSage Copilot. Ask for symptom triage, compare recent drift, review your next cultivation actions, or translate image findings into a concrete operating plan.",
  },
];

const suggestedPrompts = [
  "How should I structure a baseline image capture routine for each plant?",
  "What does PhenoSage need to compare nutrient drift over time?",
  "Turn a yellowing leaf report into a daily action checklist.",
];

export function AssistantWorkspace() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);

  const canSubmit = input.trim().length > 0 && !isStreaming;

  const runtimeLabel = useMemo(() => {
    if (isStreaming) {
      return "Generating response";
    }

    return "Ready";
  }, [isStreaming]);

  async function submitMessage(message: string) {
    const trimmed = message.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    setErrorMessage(null);
    setInput("");
    setIsStreaming(true);

    const userMessage: WorkspaceMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      status: "complete",
      content: trimmed,
    };

    const assistantId = `assistant-${Date.now()}`;
    const placeholder: WorkspaceMessage = {
      id: assistantId,
      role: "assistant",
      status: "streaming",
      content: "",
    };

    setMessages((current) => [...current, userMessage, placeholder]);

    try {
      // Create the messages array for the backend API
      const apiMessages = [
        ...messages.filter((m) => m.id !== "welcome"),
        userMessage,
      ].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch("/api/chat", {
        body: JSON.stringify({ messages: apiMessages, threadId }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const nextThreadId = response.headers.get("x-chat-thread-id");
      if (nextThreadId) {
        setThreadId(nextThreadId);
      }

      if (!response.ok || !response.body) {
        const body = await response.text();
        throw new Error(body || "PhenoSage could not reach the assistant.");
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        accumulated += decoder.decode(value, { stream: true });
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? { ...entry, content: accumulated, status: "streaming" }
              : entry,
          ),
        );
      }

      accumulated += decoder.decode();
      setMessages((current) =>
        current.map((entry) =>
          entry.id === assistantId
            ? {
                ...entry,
                content:
                  accumulated ||
                  "The assistant returned an empty response. Try again with more grow context.",
                status: "complete",
              }
            : entry,
        ),
      );
    } catch (error) {
      setMessages((current) =>
        current.filter((entry) => entry.id !== assistantId),
      );
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "PhenoSage could not reach the assistant.",
      );
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_340px]">
      <section className="surface-panel-elevated flex min-h-[720px] flex-col overflow-hidden">
        <div className="border-b border-border px-6 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <Badge tone="accent">Grow-aware copilot</Badge>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-[-0.05em] text-foreground">
                  Operator chat
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  Responses stream from the same-origin chat route and are
                  currently grounded by persisted findings plus the active chat
                  thread. Broader grow context can deepen from there as more
                  data lands.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={isStreaming ? "warning" : "success"}>
                {runtimeLabel}
              </Badge>
              <Badge tone="default">Route handler scoped</Badge>
              {threadId ? <Badge tone="accent">Thread active</Badge> : null}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="metric-chip">Grounded findings</span>
            <span className="metric-chip">Persisted thread history</span>
            <span className="metric-chip">Same-origin streaming</span>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1rem] border border-border bg-background-subtle/50 p-4">
              <TimelineIcon className="mb-3 h-4 w-4 text-accent" />
              <p className="text-sm font-semibold text-foreground">
                Timeline context
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Uses persisted findings today and keeps the thread history in
                the same authenticated workspace.
              </p>
            </div>
            <div className="rounded-[1rem] border border-border bg-background-subtle/50 p-4">
              <AnalysisIcon className="mb-3 h-4 w-4 text-accent" />
              <p className="text-sm font-semibold text-foreground">
                Structured reasoning
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Built for action-oriented replies instead of generic chatbot
                copy.
              </p>
            </div>
            <div className="rounded-[1rem] border border-border bg-background-subtle/50 p-4">
              <SparkIcon className="mb-3 h-4 w-4 text-accent" />
              <p className="text-sm font-semibold text-foreground">
                Streaming first
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The chat surface keeps latency visible while preserving message
                hierarchy.
              </p>
            </div>
          </div>

          <div className="space-y-5">
            {messages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  "flex gap-4",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                {message.role === "assistant" ? (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.75rem] border border-border bg-surface text-accent shadow-sm">
                    <AssistantIcon className="h-4 w-4" />
                  </div>
                ) : null}
                <div
                  className={cn(
                    "max-w-[44rem] rounded-[1.25rem] border px-5 py-4 text-sm leading-7 shadow-sm",
                    message.role === "assistant"
                      ? "rounded-tl-sm border-border bg-surface text-foreground"
                      : "rounded-tr-sm border-accent-strong bg-accent text-accent-foreground",
                  )}
                >
                  <div className="mb-3 flex items-center gap-2">
                    <Badge
                      tone={message.role === "assistant" ? "accent" : "default"}
                    >
                      {message.role === "assistant" ? "PhenoSage" : "Operator"}
                    </Badge>
                    {message.status === "streaming" ? (
                      <span className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">
                        Streaming
                      </span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap">
                    {message.content || "Preparing response..."}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="border-t border-border px-6 py-5">
          {errorMessage ? (
            <div className="mb-4 rounded-[1rem] border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
              {errorMessage}
            </div>
          ) : null}
          <div className="mb-4 flex flex-wrap gap-2">
            {suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                className="rounded-[1rem] border border-border bg-surface px-3 py-2 text-left text-sm text-muted-foreground transition hover:border-accent hover:text-foreground"
                disabled={isStreaming}
                onClick={() => submitMessage(prompt)}
                type="button"
              >
                {prompt}
              </button>
            ))}
          </div>
          <form
            className="rounded-[1.25rem] border border-border bg-surface p-3 shadow-sm focus-within:ring-2 focus-within:ring-accent/50 focus-within:border-accent"
            onSubmit={(event) => {
              event.preventDefault();
              void submitMessage(input);
            }}
          >
            <label className="sr-only" htmlFor="assistant-message">
              Ask the PhenoSage assistant
            </label>
            <textarea
              className="min-h-[116px] w-full resize-none bg-transparent px-3 py-2 text-sm leading-7 text-foreground placeholder:text-muted-foreground focus:outline-none"
              id="assistant-message"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submitMessage(input);
                }
              }}
              placeholder="Ask for symptom triage, compare drift across image sets, or turn findings into a concrete daily action plan."
              value={input}
            />
            <div className="flex flex-col gap-3 border-t border-border px-3 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] text-muted-foreground">
                Shift + Enter adds a new line. Replies stream directly into the
                conversation.
              </p>
              <Button disabled={!canSubmit} type="submit">
                {isStreaming ? "Streaming..." : "Send to copilot"}
              </Button>
            </div>
          </form>
        </div>
      </section>

      <aside className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Context window</CardTitle>
            <CardDescription>
              These sources support replies now and define what should deepen
              next.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-[1rem] border border-border bg-background-subtle/50 p-4">
              <div className="mb-3 flex items-center gap-3">
                <AnalysisIcon className="h-4 w-4 text-accent" />
                <p className="text-sm font-semibold text-foreground">
                  Visual doctor
                </p>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Structured image findings, severity ranking, and recommended
                actions.
              </p>
            </div>
            <div className="rounded-[1rem] border border-border bg-background-subtle/50 p-4">
              <div className="mb-3 flex items-center gap-3">
                <TimelineIcon className="h-4 w-4 text-accent" />
                <p className="text-sm font-semibold text-foreground">
                  Longitudinal history
                </p>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Plant image comparisons, manual observations, and recurring
                issues.
              </p>
            </div>
            <div className="rounded-[1rem] border border-border bg-background-subtle/50 p-4">
              <div className="mb-3 flex items-center gap-3">
                <AlertIcon className="h-4 w-4 text-accent" />
                <p className="text-sm font-semibold text-foreground">
                  Action queue
                </p>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Daily summaries, proactive reminders, and grow-stage tasks.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assistant posture</CardTitle>
            <CardDescription>
              The assistant is designed for operational clarity, not
              conversational filler.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <div className="flex items-start gap-3">
              <CheckCircleIcon className="mt-0.5 h-4 w-4 text-success" />
              Evidence-first tone with concrete next actions.
            </div>
            <div className="flex items-start gap-3">
              <ActivityIcon className="mt-0.5 h-4 w-4 text-accent" />
              Same-origin route handler boundary preserved.
            </div>
            <div className="flex items-start gap-3">
              <SparkIcon className="mt-0.5 h-4 w-4 text-accent" />
              UI prepared for future tool outputs and source chips.
            </div>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
