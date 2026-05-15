# CodeQL Triage Runbook

## When is this runbook relevant?

The `CodeQL — Block High/Critical` CI job fails when GitHub Code Scanning
finds **at least one open alert at severity High or Critical** on the commit
being tested. This document explains how to investigate, fix, and (when
necessary) request an exemption.

---

## 1. Find the alert

```bash
# GitHub UI
https://github.com/stevenschling13/PhenoSage/security/code-scanning

# Filter: state=open, severity=high|critical
# or click the failing job link in the PR check list — it prints the full alert text.
```

The failing step prints a list like:

```
[HIGH] js/code-injection: User-controlled data flows into eval()
  (apps/web/src/lib/server/some-file.ts:42)
```

---

## 2. Investigate

### Is it a true positive?

1. Open the file and line number from the alert.
2. Read the CodeQL rule page (linked in the alert). Every CodeQL rule has
   documentation with example payloads.
3. Trace the data flow: CodeQL gives you a "Show paths" view in the Security
   tab. Follow it from source (untrusted input) to sink (dangerous operation).
4. Ask: "Can an attacker realistically reach this sink with controlled input?"

### Common false positive patterns in this codebase

| Rule                | Why it fires                 | Why it's usually FP                                  |
| ------------------- | ---------------------------- | ---------------------------------------------------- |
| `js/redos`          | RegExp applied to user input | Our patterns have fixed-width quantifiers            |
| `js/path-injection` | Template path strings        | Paths come from server-side config, not user input   |
| `py/sql-injection`  | ORM query building           | We use supabase-py which parameterises automatically |

---

## 3. Fix it (true positive)

Address the finding in the same PR. Common remediation patterns:

- **XSS / HTML injection** — use a typed React component; never `dangerouslySetInnerHTML`.
- **Path traversal** — validate the path against an allowlist before use.
- **SSRF** — use the `validate_storage_path()` validator already in
  `apps/analysis/app/models/analysis.py` as a reference; reject non-path inputs.
- **Code injection** — remove `eval()` / `Function()` / dynamic `import()` on
  user-controlled strings; if unavoidable, gate with a strict allowlist.
- **Insecure randomness** — replace `Math.random()` with `crypto.getRandomValues()`.

After the fix, run:

```bash
pnpm run check:code-scanning   # blocks common patterns at lint time
pnpm run security:routes        # route-security audit
pnpm turbo run type-check lint test
```

---

## 4. Request an exemption (false positive)

Exemptions are only for **confirmed false positives**. The bar is:

1. Write a clear explanation of why the finding is not exploitable in the PR
   description under `## Follow-ups → CodeQL exemption`.
2. Label the PR `codeql:exemption`.
3. A repo maintainer (human, not bot) reviews the justification and applies
   a CodeQL alert dismissal via the GitHub Security tab with reason "False
   positive" and a note.

**Do not merge with a suppresssion comment** (`// CodeQL[…]`) without the
maintainer review step above. Inline suppressions committed without a
matching dismissal in the Security tab are rejected during monthly audit.

---

## 5. Escalation

- If you cannot determine whether an alert is exploitable within one business
  day, treat it as a true positive and open a `bug` issue labeled
  `security` + `triage` with the alert URL, then follow `docs/runbooks/incident-response.md`.
- Critical severity alerts on `main` require same-day investigation regardless
  of false-positive likelihood.

---

## 6. Branch protection note

The `CodeQL — Block High/Critical` job is listed as a **required** check in
the `main` branch protection rule. To change the threshold (e.g., promote
Medium alerts to blocking) update `.github/workflows/codeql.yml`
(`blocking` array in the `severity-gate` job) and this document in the same PR.
