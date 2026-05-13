import { NextRequest, NextResponse } from "next/server";
import { getAIClient } from "@/lib/server/ai-client";
import { getServerSession } from "@/lib/server/auth";
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
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 }),
      requestId,
    );
  }

  const userId = session.user?.id ?? null;

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

  const message = typeof body?.message === "string" ? body.message.trim() : "";
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
  const toolCtx = { userId, requestId };

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
        controller.enqueue(
          encoder.encode(
            "\n\nI gathered some data but couldn't finalize a response. Could you rephrase or narrow the question?",
          ),
        );
        controller.close();
      } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        if (isAbort) {
          // Browser disconnected mid-stream. Close cleanly.
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        logServerEvent("error", "chat stream failed", {
          requestId,
          userId,
          error: err instanceof Error ? err.message : "unknown_error",
        });
        controller.error(
          new Error(
            `Chat stream failed (request ${requestId}). Please try again.`,
          ),
        );
      }
    },
  });

  return new NextResponse(readable, {
    headers: withRequestIdHeader(
      {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
      requestId,
    ),
  });
}
