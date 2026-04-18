import { NextResponse } from "next/server";

export const runtime = "edge";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "phenosage-web",
    env:
      process.env["NEXT_PUBLIC_APP_ENV"] ?? process.env.NODE_ENV ?? "unknown",
    commit:
      process.env["VERCEL_GIT_COMMIT_SHA"] ??
      process.env["GIT_COMMIT_SHA"] ??
      "unknown",
    timestamp: new Date().toISOString(),
  });
}
