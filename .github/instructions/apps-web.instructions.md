---
applyTo: "apps/web/**"
---

# apps/web — Next.js App Router Rules

- Use the **App Router** under `src/app/**`. No `pages/` directory.
- TypeScript strict mode is on. No `any`, no `@ts-ignore` without a comment explaining why.
- Default to **Server Components**. Add `"use client"` only when you need
  state, effects, or browser APIs.

## Server-only modules

- All backend access (Supabase service role, analysis service, OpenAI) lives
  in `src/lib/server/**` and starts with `import "server-only";`.
- Route Handlers in `src/app/api/**` are the **only** caller of those modules
  for user-initiated requests.

## Env vars

- `NEXT_PUBLIC_*` is shipped to the browser. Treat it as public.
- Server-only secrets: `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
  `ANALYSIS_SERVICE_URL`, `ANALYSIS_SERVICE_API_KEY`. Never reference these
  outside `src/lib/server/**` or Route Handlers.

## Route Handlers

- Authenticate every non-`/api/health` route via `getServerSession()` /
  `getServerUser()` from `src/lib/server/auth.ts`.
- Validate request bodies. Return `400` on shape errors, `401` unauthenticated,
  `403` forbidden, `415` unsupported media type, `5xx` only for genuine errors.
- Never echo internal error messages to the client; log server-side.

## Storage

- Upload paths follow `plants/{plantId}/{timestamp}-{filename}`.
- Always use signed URLs. The `plant-images` bucket is private.

## Forbidden in this tree

- Importing `src/lib/server/**` from a client component.
- Calling `https://*.railway.app/...` or `https://*.supabase.co/storage/...`
  from a client component.
- Adding a `middleware.ts` that proxies to backend services.
