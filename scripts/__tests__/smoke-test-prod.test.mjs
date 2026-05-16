import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function runSmoke(baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pwsh",
      ["scripts/smoke-test-prod.ps1", "-Base", baseUrl],
      { cwd: repoRoot },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function withServer(handler, callback) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function writeRoot(res) {
  res.writeHead(200, {
    "Content-Type": "text/html",
    "Content-Security-Policy": "default-src 'self'",
    "Permissions-Policy": "camera=(self)",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=63072000",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  res.end("<!doctype html><title>PhenoSage</title>");
}

test("production smoke treats expected protected-page redirects as passing", async () => {
  await withServer(
    (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (["/", "/auth", "/assistant"].includes(url.pathname)) {
        writeRoot(res);
        return;
      }
      if (["/dashboard", "/grows", "/settings"].includes(url.pathname)) {
        res.writeHead(307, { Location: "/auth" });
        res.end();
        return;
      }
      if (url.pathname === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (
        [
          "/api/chat",
          "/api/uploads/sign",
          "/api/plants/abc/timeline",
          "/api/plants/abc/analysis/latest",
          "/api/internal/cron/daily-summary",
        ].includes(url.pathname)
      ) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    },
    async (baseUrl) => {
      const result = await runSmoke(baseUrl);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /PASSED/);
      assert.doesNotMatch(result.stdout + result.stderr, /\bERR\b/);
    },
  );
});

test("production smoke reports transport errors without null-header noise", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");

  const result = await runSmoke(`http://127.0.0.1:${port}`);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /FAILED/);
  assert.match(result.stdout, /Unable to fetch root/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /Cannot index into a null array/,
  );
});
