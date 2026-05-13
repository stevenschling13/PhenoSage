import { NextRequest, NextResponse } from "next/server";
import { getAIClient } from "@/lib/server/ai-client";
import {
  createSupabaseServerClient,
  getServerSession,
} from "@/lib/server/auth";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
  withRequestIdHeader,
} from "@/lib/server/request-id";
import { loadGrowContextSummary } from "@/lib/server/chat-context";
import {
  CHAT_SYSTEM_PROMPT,
  renderGrowContextBlock,
} from "@/lib/server/chat-prompt";
import {
  CHAT_TOOL_DEFINITIONS,
  executeChatTool,
} from "@/lib/server/chat-tools";
import {
  appendMessage,
  assertThreadOwner,
  createThread,
  touchThread,
} from "@/lib/server/chat-persistence";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";

// Cap individual messages so a single request can't fan out into a huge
// context or push us over the model's input limit.
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_HISTORY_MESSAGES = 24;
const MAX_THREAD_ID_LENGTH = 64;
const MAX_GROW_ID_LENGTH = 64;
const MAX_PLANT_ID_LENGTH = 64;
const MAX_TOOL_ITERATIONS = 4;
const MODEL = "gpt-4o";

type IncomingMessage = {
  role: "user" | "assistant";
  content: string;
};

function isIncomingMessage(v: unknown): v is IncomingMessage {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    (m["role"] === "user" || m["role"] === "assistant") &&
    typeof m["content"] === "string"
  );
}

export async function POST(request: NextRequest) {
  // Resolve a request id up front but fall back to a sentinel if even that
  // fails — we want the top-level catch below to always be able to emit a
  // structured envelope instead of re-throwing into Next's default error
  // handler (which yields a bare 500 the chat UI can't parse).
  let requestId: string;
  try {
    requestId = getOrCreateRequestId(request);
  } catch {
    requestId = "unknown";
  }

  // Single top-level safety net. Any synchronous throw or unhandled
  // rejection before we hand back the streaming response (Supabase auth
  // failure, missing env var in getAIClient / getDbClient, openai SDK
  // constructor blow-up, Postgres write failure in chat-persistence, etc.)
  // lands here as a structured JSON 500 with the requestId, never a bare
  // 500 with an empty body. Errors *during* streaming are handled inside
  // the ReadableStream's start(controller) below.
  let userId: string | null = null;
  let threadId: string | null = null;
  try {
    const session = await getServerSession();
    if (!session) {
      return attachRequestId(
        NextResponse.json(
          { error: "Unauthorized", requestId },
          { status: 401 },
        ),
        requestId,
      );
    }

    userId = session.user?.id ?? null;

    const rate = await rateLimit({
      key: `chat:${rateLimitKeyFromRequest(request, userId)}`,
      limit: 20,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      return attachRequestId(
        NextResponse.json(
          { error: "Too many chat requests. Try again shortly.", requestId },
          { status: 429 },
        ),
        requestId,
      );
    }

    let body: {
      threadId?: string;
      message?: string;
      growId?: string;
      plantId?: string;
      history?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return attachRequestId(
        NextResponse.json(
          { error: "Request body must be valid JSON.", requestId },
          { status: 400 },
        ),
        requestId,
      );
    }

    const message =
      typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) {
      return attachRequestId(
        NextResponse.json(
          { error: "message is required", requestId },
          { status: 400 },
        ),
        requestId,
      );
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return attachRequestId(
        NextResponse.json(
          {
            error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
            requestId,
          },
          { status: 413 },
        ),
        requestId,
      );
    }
    if (
      typeof body.threadId === "string" &&
      body.threadId.length > MAX_THREAD_ID_LENGTH
    ) {
      return attachRequestId(
        NextResponse.json(
          { error: "threadId is too long.", requestId },
          { status: 400 },
        ),
        requestId,
      );
    }
    if (
      typeof body.growId === "string" &&
      body.growId.length > MAX_GROW_ID_LENGTH
    ) {
      return attachRequestId(
        NextResponse.json(
          { error: "growId is too long.", requestId },
          { status: 400 },
        ),
        requestId,
      );
    }
    if (
      typeof body.plantId === "string" &&
      body.plantId.length > MAX_PLANT_ID_LENGTH
    ) {
      return attachRequestId(
        NextResponse.json(
          { error: "plantId is too long.", requestId },
          { status: 400 },
        ),
        requestId,
      );
    }

    // Validate optional client-supplied history. We trust role+content shape but
    // not the model identities — the server prepends the canonical system
    // prompt, so any "system" entries from the client are discarded.
    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history: IncomingMessage[] = rawHistory
      .filter(isIncomingMessage)
      .slice(-MAX_HISTORY_MESSAGES)
      .filter(
        (m) => m.content.length > 0 && m.content.length <= MAX_MESSAGE_LENGTH,
      );

    const growId =
      typeof body.growId === "string" && body.growId.length > 0
        ? body.growId
        : null;

    // Resolve / create the chat thread. We only persist when we have an
    // authenticated user id; anonymous flows shouldn't happen here (we 401'd
    // upstream) but we guard anyway. threadId is declared at the function
    // scope above so the top-level catch can include it in error logs.
    if (userId) {
      const incomingThreadId =
        typeof body.threadId === "string" && body.threadId.length > 0
          ? body.threadId
          : null;
      if (incomingThreadId) {
        const owns = await assertThreadOwner(incomingThreadId, userId);
        if (!owns) {
          return attachRequestId(
            NextResponse.json(
              { error: "Thread not found.", requestId },
              { status: 404 },
            ),
            requestId,
          );
        }
        threadId = incomingThreadId;
      } else {
        threadId = await createThread({
          userId,
          growId,
          firstUserMessage: message,
        });
      }

      // Persist the user message before we call out to the model so the
      // transcript is durable even if the stream errors.
      if (threadId) {
        await appendMessage({
          threadId,
          role: "user",
          content: message,
        });
      }
    }

    // Load grow context up-front so the model has the basics without needing
    // a tool call on every turn. Tool calls remain available for deeper data.
    const growContext = await loadGrowContextSummary(growId);

    const openai = getAIClient();

    const baseMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      { role: "system", content: renderGrowContextBlock(growContext) },
      ...history.map<ChatCompletionMessageParam>((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    const encoder = new TextEncoder();
    // Share one user-scoped supabase client across all tool calls in this
    // request. Each call previously re-parsed cookies and re-built the
    // client, which adds up across the (up to 4) tool-loop iterations.
    // executeChatTool() falls back to creating its own client per-call when
    // this one is undefined, so init failure is non-fatal.
    let cachedSupabase:
      | Awaited<ReturnType<typeof createSupabaseServerClient>>
      | undefined;
    try {
      cachedSupabase = await createSupabaseServerClient();
    } catch {
      cachedSupabase = undefined;
    }
    const toolCtx: {
      userId: string | null;
      requestId: string;
      supabase?: Awaited<ReturnType<typeof createSupabaseServerClient>>;
    } = {
      userId,
      requestId,
    };
    if (cachedSupabase) toolCtx.supabase = cachedSupabase;

    // Buffer the assistant tokens as they stream so we can persist a single
    // chat_messages row once the response completes.
    let assistantBuffer = "";

    const persistAssistant = async () => {
      if (!threadId || !assistantBuffer) return;
      await appendMessage({
        threadId,
        role: "assistant",
        content: assistantBuffer,
        metadata: { model: MODEL },
      });
      await touchThread(threadId);
    };

    const readable = new ReadableStream({
      async start(controller) {
        const working: ChatCompletionMessageParam[] = [...baseMessages];

        try {
          for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
            const stream = openai.chat.completions.stream({
              model: MODEL,
              messages: working,
              tools: CHAT_TOOL_DEFINITIONS,
              tool_choice: "auto",
              temperature: 0.3,
              stream: true,
            });

            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                assistantBuffer += delta;
                controller.enqueue(encoder.encode(delta));
              }
            }

            const final = await stream.finalChatCompletion();
            const choice = final.choices[0];
            const toolCalls = choice?.message?.tool_calls as
              | ChatCompletionMessageToolCall[]
              | undefined;

            if (!toolCalls || toolCalls.length === 0) {
              // Final answer already streamed.
              await persistAssistant();
              controller.close();
              return;
            }

            // Append the assistant turn with its tool_calls, then execute each.
            working.push({
              role: "assistant",
              content: choice?.message?.content ?? "",
              tool_calls: toolCalls,
            });

            for (const tc of toolCalls) {
              if (tc.type !== "function") continue;
              let parsedArgs: unknown = {};
              try {
                parsedArgs = tc.function.arguments
                  ? JSON.parse(tc.function.arguments)
                  : {};
              } catch {
                parsedArgs = {};
              }

              const result = await executeChatTool(
                tc.function.name,
                parsedArgs,
                toolCtx,
              );

              working.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(result).slice(0, 16_000),
              });
            }
            // Loop and let the model use the tool results.
          }

          // Hit iteration cap without a final answer. Surface a fallback so the
          // user isn't left with silence.
          const fallback =
            "\n\nI gathered some data but couldn't finalize a response. Could you rephrase or narrow the question?";
          controller.enqueue(encoder.encode(fallback));
          assistantBuffer += fallback;
          await persistAssistant();
          controller.close();
        } catch (err) {
          const isAbort = err instanceof Error && err.name === "AbortError";
          if (isAbort) {
            // Browser disconnected mid-stream. Persist whatever we already
            // streamed so the user still sees their partial reply on reload.
            await persistAssistant();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
            return;
          }
          // Classify the upstream error so we can surface something
          // useful inline. We deliberately do NOT call controller.error()
          // here: when no bytes have been flushed yet, Vercel converts a
          // would-be 200 streaming response into a bare 500 with empty
          // body, which the chat client cannot parse and shows as the
          // generic "Request failed with 500.". Instead we enqueue a
          // human-readable error as the assistant's body and close the
          // stream normally. The HTTP status stays 200, the user sees a
          // specific explanation, and the underlying cause is captured in
          // the server log with the requestId for ops correlation.
          const errMsg = err instanceof Error ? err.message : String(err);
          const status =
            err && typeof err === "object" && "status" in err
              ? Number((err as { status?: unknown }).status)
              : undefined;
          const code =
            err && typeof err === "object" && "code" in err
              ? String((err as { code?: unknown }).code)
              : undefined;

          let userFacing: string;
          if (
            status === 429 ||
            code === "insufficient_quota" ||
            /quota|rate.?limit/i.test(errMsg)
          ) {
            userFacing =
              "The AI service is rate-limited or out of quota right now. Please try again in a moment, or contact support if this persists.";
          } else if (status === 401 || status === 403) {
            userFacing =
              "The AI service rejected the request (auth or permission). The site operator has been notified.";
          } else if (status && status >= 500) {
            userFacing =
              "The AI service is temporarily unavailable. Please try again in a few seconds.";
          } else {
            userFacing =
              "Something went wrong reaching the model. Please try again.";
          }

          logServerEvent("error", "chat stream failed", {
            requestId,
            userId,
            threadId,
            upstreamStatus: status,
            upstreamCode: code,
            error: errMsg,
          });

          // If we'd already streamed some assistant text, separate the
          // partial reply from the error note. If we hadn't streamed
          // anything, this enqueue is what commits the 200 status to the
          // wire.
          const prefix = assistantBuffer
            ? "\n\n_Stream interrupted before completion._\n\n"
            : "";
          const tail = `${prefix}${userFacing} (request ${requestId})`;
          try {
            controller.enqueue(encoder.encode(tail));
            assistantBuffer += tail;
          } catch {
            /* controller may already be in an error state */
          }
          // Persist whatever the user actually saw, including the inline
          // error, so the saved transcript matches reality.
          await persistAssistant();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
    });

    const responseHeaders: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    };
    if (threadId) {
      responseHeaders["X-Chat-Thread-Id"] = threadId;
      // Browser fetch() only exposes headers in this allow-list when reading
      // from a Next.js Route Handler that surfaces them via Access-Control-
      // Expose-Headers. Same-origin reads work without it but we set it to be
      // safe if a preview URL ever serves the page from a different origin.
      responseHeaders["Access-Control-Expose-Headers"] = "X-Chat-Thread-Id";
    }

    return new NextResponse(readable, {
      headers: withRequestIdHeader(responseHeaders, requestId),
    });
  } catch (err) {
    // Log the underlying cause for operators; surface only a generic
    // message + requestId + (when available) threadId to the client so we
    // never leak server-side detail (which could include the OpenAI API
    // key, Supabase URL, env-misconfig hints, or stack frames). Operators
    // can correlate the requestId between this log line and the user's
    // browser console / network tab.
    logServerEvent("error", "chat request failed before stream", {
      requestId,
      userId,
      threadId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return attachRequestId(
      NextResponse.json(
        {
          error: `Chat request failed (request ${requestId}). Please try again.`,
          requestId,
        },
        { status: 500 },
      ),
      requestId,
    );
  }
}
