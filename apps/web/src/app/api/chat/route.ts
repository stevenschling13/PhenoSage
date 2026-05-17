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
  appendChatAttachment,
  appendMessage,
  assertThreadOwner,
  createThread,
  touchThread,
} from "@/lib/server/chat-persistence";
import { runAndPersistPlantAnalysis } from "@/lib/server/plants";
import { getAuthorizedPlantContext } from "@/lib/server/plant-access";
import { getStorageClient } from "@/lib/server/storage";
import type {
  ChatCompletionContentPart,
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
// Google Gemini's OpenAI-compatible endpoint accepts the model name in the
// same `model:` field. We default to gemini-2.5-flash because gemini-2.0-flash
// no longer carries free-tier allocation on most projects (returns 429 with
// `limit: 0`), while gemini-2.5-flash is the current free-tier-eligible
// generation that still supports streaming + tool calls + multi-turn.
//
// Override via CHAT_MODEL when billing is enabled (e.g. CHAT_MODEL=gemini-2.5-pro
// or CHAT_MODEL=gemini-3.1-pro-preview) to promote to a pro model without code
// changes.
const MODEL = process.env["CHAT_MODEL"] || "gemini-2.5-flash";

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
      attachments?: unknown;
      idempotencyKey?: string;
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

    // Parse and validate attachments BEFORE the empty-message check, so a
    // user can send an image with no text ("what's wrong with this plant?"
    // is a perfectly valid wordless intent).
    type IncomingAttachment = {
      kind: "image";
      plantId: string;
      imageId: string;
      storagePath: string;
    };
    const MAX_ATTACHMENTS = 1; // MVP: serial analysis comparisons require this.
    const rawAttachments = Array.isArray(body.attachments)
      ? body.attachments
      : [];
    if (rawAttachments.length > MAX_ATTACHMENTS) {
      return attachRequestId(
        NextResponse.json(
          {
            error: `Up to ${MAX_ATTACHMENTS} attachment per message is supported right now.`,
            requestId,
          },
          { status: 400 },
        ),
        requestId,
      );
    }
    const attachments: IncomingAttachment[] = [];
    for (const a of rawAttachments) {
      if (
        !a ||
        typeof a !== "object" ||
        (a as { kind?: unknown }).kind !== "image" ||
        typeof (a as { plantId?: unknown }).plantId !== "string" ||
        typeof (a as { imageId?: unknown }).imageId !== "string" ||
        typeof (a as { storagePath?: unknown }).storagePath !== "string"
      ) {
        return attachRequestId(
          NextResponse.json(
            {
              error:
                "Each attachment must be { kind: 'image', plantId, imageId, storagePath }.",
              requestId,
            },
            { status: 400 },
          ),
          requestId,
        );
      }
      const att = a as IncomingAttachment;
      attachments.push({
        kind: "image",
        plantId: att.plantId,
        imageId: att.imageId,
        storagePath: att.storagePath,
      });
    }

    if (!message && attachments.length === 0) {
      return attachRequestId(
        NextResponse.json(
          { error: "message or attachment is required", requestId },
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
    // Optional client-supplied dedup key. Matches the bounds used elsewhere
    // (AnalyzeRequestSchema, UploadFinalizeRequestSchema) so clients can
    // reuse a single id-minting helper across endpoints. Empty strings are
    // rejected by the length check below — they're never useful as a key
    // and surface as a clear 400 instead of being silently coerced to
    // "no idempotency".
    const idempotencyKey =
      typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
    if (
      idempotencyKey !== undefined &&
      (idempotencyKey.length < 8 || idempotencyKey.length > 128)
    ) {
      return attachRequestId(
        NextResponse.json(
          {
            error: "idempotencyKey must be between 8 and 128 characters.",
            requestId,
          },
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
    let userMessageId: string | null = null;
    // Effective text we tell the model the user said. When the user sent
    // only an image with no text, we synthesize a minimal default so the
    // model has *some* instruction; when they sent text, we use it as-is.
    const effectiveUserText =
      message ||
      (attachments.length > 0
        ? "Please analyze this plant image and explain anything notable, including changes versus prior images if you can see them."
        : "");

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
          firstUserMessage: effectiveUserText,
        });
      }

      // Persist the user message before we call out to the model so the
      // transcript is durable even if the stream errors. We capture the
      // returned id so attachment rows can foreign-key to this exact
      // chat_messages row. When the client supplied an idempotencyKey,
      // a retried request resolves to the same row id rather than
      // creating a duplicate transcript entry.
      if (threadId) {
        userMessageId = await appendMessage({
          threadId,
          role: "user",
          content: effectiveUserText,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        });
      }
    }

    // ─── Inline image analysis ──────────────────────────────────────────────
    // For each attachment, run the existing sync plant-analysis pipeline so
    // (a) the timeline gets a new analysis row and (b) the model has the
    // findings JSON in its context. We bound this with an 8s timeout per
    // image — beyond that the user is left waiting too long for chat
    // streaming to feel responsive, so we fall back to a "still working on
    // it" message and let the realtime channel push the result to whatever
    // page they navigate to next.
    type ResolvedAttachment = {
      kind: "image";
      plantId: string;
      imageId: string;
      storagePath: string;
      analysisJson: unknown | null;
      analysisId: string | null;
      timedOut: boolean;
      errorMessage?: string;
      // Base64 data URL of the image bytes, ready to drop into a
      // multimodal user message as `image_url`.
      dataUrl: string | null;
    };
    const ANALYSIS_TIMEOUT_MS = 8_000;
    const resolvedAttachments: ResolvedAttachment[] = [];
    if (attachments.length > 0) {
      const storage = getStorageClient();
      for (const att of attachments) {
        // Authorize the plant — RLS-gated via the user's session — before
        // doing anything expensive. We deliberately do NOT trust the
        // imageId/storagePath the client sent; we only re-verify the plant.
        // The image row's existence is verified implicitly by
        // runAndPersistPlantAnalysis selecting it.
        const plantCtx = await getAuthorizedPlantContext(att.plantId);
        if (!plantCtx) {
          resolvedAttachments.push({
            ...att,
            analysisJson: null,
            analysisId: null,
            timedOut: false,
            errorMessage: "plant not accessible",
            dataUrl: null,
          });
          continue;
        }

        // Pull the raw image bytes from storage in parallel with the
        // analysis call so we don't double the wall-time.
        const downloadPromise = storage
          .from("plant-images")
          .download(att.storagePath)
          .then(async ({ data, error }) => {
            if (error || !data) return null;
            try {
              const buf = Buffer.from(await data.arrayBuffer());
              // Default to image/jpeg if we don't know — Gemini accepts
              // any of the standard image MIMEs for image_url parts.
              const mime = (data as Blob).type || "image/jpeg";
              return `data:${mime};base64,${buf.toString("base64")}`;
            } catch {
              return null;
            }
          })
          .catch(() => null);

        const analysisPromise = runAndPersistPlantAnalysis({
          plantId: att.plantId,
          imageId: att.imageId,
          requestId,
        }).then(
          (r) => ({ ok: true as const, value: r }),
          (err: unknown) => ({
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          }),
        );

        const timeoutPromise = new Promise<{ timedOut: true }>((resolve) =>
          setTimeout(() => resolve({ timedOut: true }), ANALYSIS_TIMEOUT_MS),
        );

        const [analysisOutcome, dataUrl] = await Promise.all([
          Promise.race([analysisPromise, timeoutPromise]),
          downloadPromise,
        ]);

        if ("timedOut" in analysisOutcome) {
          resolvedAttachments.push({
            ...att,
            analysisJson: null,
            analysisId: null,
            timedOut: true,
            dataUrl,
          });
        } else if (!analysisOutcome.ok) {
          resolvedAttachments.push({
            ...att,
            analysisJson: null,
            analysisId: null,
            timedOut: false,
            errorMessage: analysisOutcome.error,
            dataUrl,
          });
        } else {
          const r = analysisOutcome.value;
          resolvedAttachments.push({
            ...att,
            analysisJson: r?.analysis ?? null,
            analysisId: r?.analysisId ?? null,
            timedOut: false,
            dataUrl,
          });
        }

        // Persist the chat_message_attachments row regardless of analysis
        // outcome — we want the image visible in the transcript even if
        // analysis timed out (the realtime channel will fill in the
        // analysis result on whatever page the user navigates to).
        const last = resolvedAttachments[resolvedAttachments.length - 1]!;
        if (userMessageId) {
          await appendChatAttachment({
            messageId: userMessageId,
            kind: "image",
            plantId: att.plantId,
            imageId: att.imageId,
            storagePath: att.storagePath,
            analysisId: last.analysisId,
          });
        }
      }
    }

    // Load grow context up-front so the model has the basics without needing
    // a tool call on every turn. Tool calls remain available for deeper data.
    const growContext = await loadGrowContextSummary(growId);

    const openai = getAIClient();

    // Build the user turn. When images are attached we send a multipart
    // content array (text + image_url for each image) so Gemini's
    // OpenAI-compat endpoint sees the actual pixels — that's the whole
    // point of attaching an image to a chat message.
    const userParts: ChatCompletionContentPart[] = [];
    if (effectiveUserText) {
      userParts.push({ type: "text", text: effectiveUserText });
    }
    for (const att of resolvedAttachments) {
      if (att.dataUrl) {
        userParts.push({
          type: "image_url",
          image_url: { url: att.dataUrl },
        });
      }
    }

    // Build an analysis-results system note from any attachments that
    // completed analysis in time. Including the structured findings JSON
    // alongside the raw image gives the model both signal sources to
    // ground its reply in.
    let analysisSystemNote: string | null = null;
    const analyzed = resolvedAttachments.filter((a) => a.analysisJson !== null);
    const stillRunning = resolvedAttachments.filter((a) => a.timedOut);
    const failed = resolvedAttachments.filter(
      (a) => a.errorMessage && !a.timedOut,
    );
    if (analyzed.length > 0 || stillRunning.length > 0 || failed.length > 0) {
      const lines: string[] = ["## Inline image analysis"];
      for (const a of analyzed) {
        lines.push(
          `- Plant ${a.plantId} / image ${a.imageId}: ${JSON.stringify(a.analysisJson).slice(0, 4_000)}`,
        );
      }
      for (const a of stillRunning) {
        lines.push(
          `- Plant ${a.plantId} / image ${a.imageId}: analysis still running (timed out > ${ANALYSIS_TIMEOUT_MS}ms). Tell the user the analysis is processing and will appear on the plant page shortly.`,
        );
      }
      for (const a of failed) {
        lines.push(
          `- Plant ${a.plantId} / image ${a.imageId}: analysis failed (${a.errorMessage}). Continue from visual inspection only.`,
        );
      }
      analysisSystemNote = lines.join("\n");
    }

    const baseMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      { role: "system", content: renderGrowContextBlock(growContext) },
      ...(analysisSystemNote
        ? ([
            { role: "system", content: analysisSystemNote },
          ] as ChatCompletionMessageParam[])
        : []),
      ...history.map<ChatCompletionMessageParam>((m) => ({
        role: m.role,
        content: m.content,
      })),
      {
        role: "user",
        content: userParts.some((p) => p.type === "image_url")
          ? userParts
          : effectiveUserText,
      },
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
            const stream = openai.chat.completions.stream(
              {
                model: MODEL,
                messages: working,
                tools: CHAT_TOOL_DEFINITIONS,
                tool_choice: "auto",
                temperature: 0.3,
                stream: true,
              },
              // Forward the inbound request's AbortSignal so a client
              // disconnect mid-reply also cancels the upstream Gemini
              // call. Without this, navigating away wastes tokens for
              // up to MAX_TOOL_ITERATIONS rounds of completion.
              { signal: request.signal },
            );

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
      // Defeat any intermediary buffering so tokens reach the browser the
      // moment the model emits them. Without these, Vercel's edge layer
      // and any proxy in between can pool the response into one big
      // chunk, defeating the streaming UX.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
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
    const errMsg = err instanceof Error ? err.message : String(err);
    // Classify common configuration / dependency failures into a short,
    // non-sensitive code. The code names a *category* (which env var or
    // upstream is misconfigured) without echoing the secret value or the
    // raw exception text. Operators can map the code to the relevant
    // Vercel env var without needing log access.
    let reason: string | null = null;
    if (/GEMINI_API_KEY/i.test(errMsg)) {
      reason = "ai_unconfigured"; // GEMINI_API_KEY missing on this deployment
    } else if (
      /SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL/i.test(errMsg)
    ) {
      reason = "db_unconfigured"; // service-role env missing on this deployment
    } else if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(errMsg)) {
      reason = "upstream_unreachable";
    }
    // For ai_unconfigured specifically, gather a presence-only inventory of
    // env-var NAMES (never values) that look like they might hold an AI
    // credential. SERVER-LOG ONLY — names like "FOO_API_KEY" obey the same
    // redaction posture as anything else in the repo, but we no longer
    // surface this list in the response body. Browser-visible envelopes must
    // not enumerate which env-var names exist on the deployment.
    let aiEnvInventory: string[] | undefined;
    if (reason === "ai_unconfigured") {
      const NEEDLE =
        /(GEMINI|GOOGLE|OPENAI|ANTHROPIC|VERTEX|AI[_-]?KEY|API[_-]?KEY)/i;
      const SAFE_TO_LIST = /^[A-Z][A-Z0-9_]{2,80}$/; // conservative shape
      aiEnvInventory = Object.keys(process.env)
        .filter(
          (k) =>
            SAFE_TO_LIST.test(k) &&
            NEEDLE.test(k) &&
            typeof process.env[k] === "string" &&
            (process.env[k] as string).length > 0,
        )
        .sort();
    }
    logServerEvent("error", "chat request failed before stream", {
      requestId,
      userId,
      threadId,
      reason,
      aiEnvInventory,
      error: errMsg,
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Embed the build SHA in every error so that when a user pastes the
    // message we can immediately tell which deployment served the request
    // (Vercel deployment URLs are pinned per build, so a stale tab can hit
    // an old build forever — this label removes that ambiguity).
    const buildSha =
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.COMMIT_SHA ||
      process.env.GITHUB_SHA ||
      "unknown";
    const buildShaShort = buildSha.slice(0, 7);
    let userFacing: string;
    if (reason === "ai_unconfigured") {
      // Do NOT leak which env-var names are present — that's a fingerprint
      // of the deployment configuration. Operators can correlate via the
      // requestId in the server log (which still carries `aiEnvInventory`)
      // or hit the dedicated `/api/chat/diag` route which gates on auth.
      userFacing =
        `Chat request failed (ai_unconfigured, request ${requestId}, build ${buildShaShort}). ` +
        `The AI provider is not configured for this deployment. ` +
        `Please contact the site operator.`;
    } else if (reason) {
      userFacing = `Chat request failed (${reason}, request ${requestId}, build ${buildShaShort}). Please contact the site operator.`;
    } else {
      userFacing = `Chat request failed (request ${requestId}, build ${buildShaShort}). Please try again.`;
    }
    return attachRequestId(
      NextResponse.json(
        {
          error: userFacing,
          requestId,
          reason,
          buildSha,
        },
        { status: 500 },
      ),
      requestId,
    );
  }
}
