---
applyTo: "packages/shared/**"
---

# packages/shared — Shared Contract Rules

This package is the **single source of truth** for cross-service types
(web ⇄ analysis ⇄ DB row shapes seen by the web app).

- TypeScript only. No runtime dependencies allowed beyond `typescript` itself.
- Pure types and (optionally) pure functions. No I/O, no `process.env`, no `fetch`.
- Any rename or field removal is a **breaking change**. Coordinate the change
  in `apps/web`, `apps/analysis`, and the next migration in the **same PR**.
- Field naming is `camelCase` on the TS side; SQL uses `snake_case`. Map
  explicitly at the boundary.

## Forbidden

- Importing from `apps/**`.
- Adding React, Node, or browser-only types.
- Adding optional fields to silently widen contracts — prefer a new explicit
  type or a versioned shape.
