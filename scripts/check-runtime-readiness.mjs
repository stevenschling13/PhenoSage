#!/usr/bin/env node

function parseArgs(argv) {
  const args = { url: process.env.READINESS_URL ?? process.env.APP_URL ?? "" };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--url") {
      args.url = argv[i + 1] ?? "";
      i += 1;
    }
  }

  return args;
}

function resolveReadyUrl(input) {
  if (!input) {
    throw new Error(
      "Missing deployment URL. Pass --url https://<deployment> or set READINESS_URL. Protected previews can use a full /api/ready URL that already includes bypass or share query parameters.",
    );
  }

  const base = new URL(input);

  if (base.pathname.endsWith("/api/ready")) {
    return base.toString();
  }

  base.pathname = `${base.pathname.replace(/\/$/, "")}/api/ready`;
  return base.toString();
}

function summarizeChecks(payload) {
  if (!Array.isArray(payload?.checks)) {
    return [];
  }

  return payload.checks.map((check) => ({
    name: check?.name ?? "unknown",
    ok: Boolean(check?.ok),
    detail: check?.detail ?? "",
  }));
}

async function main() {
  const { url } = parseArgs(process.argv.slice(2));
  const readyUrl = resolveReadyUrl(url);

  const response = await fetch(readyUrl, {
    headers: { accept: "application/json" },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const checks = summarizeChecks(payload);
  const failedChecks = checks.filter((check) => !check.ok);

  console.log(`Readiness URL: ${readyUrl}`);
  console.log(`HTTP status: ${response.status}`);

  if (payload?.status) {
    console.log(`Service status: ${payload.status}`);
  }

  if (payload?.commit) {
    console.log(`Commit: ${payload.commit}`);
  }

  if (checks.length > 0) {
    console.log("Checks:");
    for (const check of checks) {
      const marker = check.ok ? "OK  " : "FAIL";
      const suffix = check.detail ? ` (${check.detail})` : "";
      console.log(`- ${marker} ${check.name}${suffix}`);
    }
  }

  if (!response.ok || failedChecks.length > 0) {
    const reason =
      failedChecks.length > 0
        ? `readiness checks failed: ${failedChecks
            .map((check) => check.name)
            .join(", ")}`
        : `unexpected status ${response.status}`;

    throw new Error(`Deployment is not ready: ${reason}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
