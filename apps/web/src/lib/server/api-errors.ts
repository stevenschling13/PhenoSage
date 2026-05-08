import "server-only";
import { NextResponse } from "next/server";
import { attachRequestId } from "./request-id";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "UNPROCESSABLE_ENTITY"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  requestId: string,
): NextResponse {
  return attachRequestId(
    NextResponse.json({ error: { code, message, requestId } }, { status }),
    requestId,
  );
}
