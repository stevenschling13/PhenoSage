import "server-only";
import { NextResponse } from "next/server";
import { attachRequestId } from "./request-id";

/**
 * Stable, machine-readable codes for every JSON API failure surfaced to the
 * browser. Add new codes here (and to the schema in `schemas.ts`) rather than
 * inventing ad-hoc strings in route handlers — clients pattern-match on these.
 *
 * `UPSTREAM_*` distinguishes failures caused by an upstream dependency
 * (analysis service, model provider, Supabase) from failures in our own code.
 * `CONFIGURATION_ERROR` is the safe code to surface when a deployment is
 * missing required env / secrets — never echo the variable name to the client.
 */
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "UNPROCESSABLE_ENTITY"
  | "RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "CONFIGURATION_ERROR"
  | "INTERNAL_ERROR";

export interface ApiErrorOptions {
  /**
   * When set, attach a `Retry-After` header (in seconds, integer >= 0).
   * Use for `RATE_LIMITED`, `UPSTREAM_RATE_LIMITED`, and `UPSTREAM_UNAVAILABLE`.
   */
  retryAfterSeconds?: number;
}

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  requestId: string,
  options: ApiErrorOptions = {},
): NextResponse {
  const response = attachRequestId(
    NextResponse.json({ error: { code, message, requestId } }, { status }),
    requestId,
  );
  if (
    typeof options.retryAfterSeconds === "number" &&
    Number.isFinite(options.retryAfterSeconds) &&
    options.retryAfterSeconds >= 0
  ) {
    // Per RFC 7231, Retry-After can be either an HTTP-date or a delta-seconds
    // integer. We always emit an integer for portability.
    response.headers.set(
      "Retry-After",
      Math.ceil(options.retryAfterSeconds).toString(),
    );
  }
  return response;
}
