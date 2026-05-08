import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { ZodIssue, ZodTypeAny } from "zod";
import { MAX_JSON_REQUEST_BYTES } from "@phenosage/shared";
import { logServerEvent, REQUEST_ID_HEADER } from "./request-id";

/**
 * Parse a JSON request body, enforcing a byte cap and a Zod schema.
 *
 * Returns either the validated `data` (call sites destructure
 * `result.data`) or a fully-formed `response` to return immediately.
 * Always sets the request-id header on the response so the client can
 * correlate failures with server logs.
 *
 * Status-code contract:
 *   400 invalid_json | invalid_request
 *   413 request_body_too_large
 */
export type ParseJsonOk<T> = { ok: true; data: T };
export type ParseJsonErr = { ok: false; response: NextResponse };
export type ParseJsonResult<T> = ParseJsonOk<T> | ParseJsonErr;

export interface ParseJsonOptions {
  requestId: string;
  /** Override the default 1 MB body cap (e.g. for cron payloads). */
  maxBytes?: number;
  /** Permit `Content-Type: text/plain` without warning. Default false. */
  allowNonJsonContentType?: boolean;
}

interface ErrorBody {
  error: string;
  requestId: string;
  issues?: Array<{ path: string; code: string; message: string }>;
}

function errorResponse(
  body: ErrorBody,
  status: number,
  requestId: string,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

function summarizeIssues(issues: ZodIssue[]) {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

export async function parseJson<TSchema extends ZodTypeAny>(
  request: NextRequest,
  schema: TSchema,
  opts: ParseJsonOptions,
): Promise<ParseJsonResult<ReturnType<TSchema["parse"]>>> {
  const { requestId, maxBytes = MAX_JSON_REQUEST_BYTES } = opts;

  if (!opts.allowNonJsonContentType) {
    const contentType = request.headers.get("content-type") ?? "";
    if (
      contentType &&
      !contentType.toLowerCase().includes("application/json")
    ) {
      logServerEvent("warn", "request rejected: non-JSON content type", {
        requestId,
        contentType,
      });
      return {
        ok: false,
        response: errorResponse(
          { error: "unsupported_media_type", requestId },
          415,
          requestId,
        ),
      };
    }
  }

  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader
    ? Number(contentLengthHeader)
    : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    logServerEvent("warn", "request body too large", {
      requestId,
      contentLength,
      maxBytes,
    });
    return {
      ok: false,
      response: errorResponse(
        { error: "request_body_too_large", requestId },
        413,
        requestId,
      ),
    };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch (error) {
    logServerEvent("warn", "failed to read request body", {
      requestId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return {
      ok: false,
      response: errorResponse(
        { error: "invalid_request", requestId },
        400,
        requestId,
      ),
    };
  }

  if (raw.length > maxBytes) {
    logServerEvent("warn", "request body too large", {
      requestId,
      bodyLength: raw.length,
      maxBytes,
    });
    return {
      ok: false,
      response: errorResponse(
        { error: "request_body_too_large", requestId },
        413,
        requestId,
      ),
    };
  }

  const trimmed = raw.length === 0 ? "{}" : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    logServerEvent("warn", "request body is not valid JSON", { requestId });
    return {
      ok: false,
      response: errorResponse(
        { error: "invalid_json", requestId },
        400,
        requestId,
      ),
    };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = summarizeIssues(result.error.issues);
    logServerEvent("warn", "request validation failed", { requestId, issues });
    return {
      ok: false,
      response: errorResponse(
        { error: "invalid_request", issues, requestId },
        400,
        requestId,
      ),
    };
  }

  return { ok: true, data: result.data as ReturnType<TSchema["parse"]> };
}
