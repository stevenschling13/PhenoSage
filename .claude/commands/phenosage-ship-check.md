---
description: Run the full pre-merge gate — validate + turbo test + turbo type-check + security audit + route security.
---

Run the following in order and stop on the first failure. Report a ✓/✗ for each.

1. `pnpm run validate`
2. `pnpm turbo run type-check test`
3. `pnpm run security:routes`
4. `pnpm run format:check` (advisory — report but don't fail)
5. `pnpm run security:audit` (advisory — report but don't fail)

If any hard step fails: stop, print the failing command, do not open a PR.
If all hard steps pass: print "SHIP-CHECK OK" and the current commit SHA.
