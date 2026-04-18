---
name: phenosage-test-patterns
description: Canonical test fixtures and patterns for PhenoSage — Supabase mocks, pytest patterns, Playwright golden paths. Use when writing or expanding tests.
---

# phenosage-test-patterns

## Vitest (web + shared)

Config: `apps/web/vitest.config.ts` (node env with `server-only` aliased to an empty module), `packages/shared/vitest.config.ts` (node env).

### Mocking process.env

```ts
const ORIGINAL_ENV = process.env;
beforeEach(() => (process.env = { ...ORIGINAL_ENV }));
afterEach(() => (process.env = ORIGINAL_ENV));
```

### Mocking fetch

```ts
const fetchSpy = vi.spyOn(globalThis, "fetch");
fetchSpy.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
```

See `apps/web/src/lib/server/__tests__/analysis-proxy.test.ts` for the full pattern.

### Route Handler tests

Import `GET`/`POST` directly from the route file and invoke with a `new Request(...)`. Example: `apps/web/src/app/api/ready/__tests__/route.test.ts`.

## pytest (analysis)

Config: `apps/analysis/pyproject.toml`. Tests live in `apps/analysis/tests`.

- Async tests use `@pytest.mark.asyncio` (strict mode).
- Use `httpx.AsyncClient(app=app, base_url="http://test")` to drive FastAPI in-process — see `tests/test_api.py`.
- Mock `openai` via monkeypatching on the module's `client.chat.completions.create`.

Run:

```bash
pytest --cov=app --cov-report=term
```

## Playwright (golden paths)

Config: `apps/web/playwright.config.ts`. Specs live in `apps/web/e2e`.

```bash
pnpm --filter web exec playwright install --with-deps
pnpm --filter web test:e2e
```

Target an existing preview:

```bash
E2E_BASE_URL=https://preview-url.vercel.app E2E_SKIP_WEBSERVER=1 \
  pnpm --filter web test:e2e
```

Golden path (to extend): auth → upload plant photo → trigger analysis → view findings → chat → daily summary.
