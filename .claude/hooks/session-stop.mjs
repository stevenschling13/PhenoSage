#!/usr/bin/env node
// Stop hook: run the lightweight validation suite at session end
// so we catch regressions before they leave the session.

import { spawnSync } from "node:child_process";

const cmd = "pnpm run validate";
const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
process.exit(r.status ?? 0);
