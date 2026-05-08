#!/usr/bin/env python3
"""
Export the analysis service OpenAPI schema to apps/analysis/openapi.json.

This is the source of truth that `scripts/check-contract-sync.mjs`
diffs against `packages/shared/src/types.ts`. Whenever a Pydantic
model in `app/models/**` changes, regenerate this file:

    cd apps/analysis
    python3 scripts/export_openapi.py

The generated file is committed. CI fails the build if the committed
file is out of sync with the current Pydantic models.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Allow running from anywhere — resolve `app.*` imports relative to the
# analysis service root.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.main import app  # noqa: E402


def main() -> int:
    schema = app.openapi()
    output = ROOT / "openapi.json"
    serialized = json.dumps(schema, indent=2, sort_keys=True) + "\n"
    if output.exists() and output.read_text(encoding="utf-8") == serialized:
        print(f"openapi.json is up to date ({output})")
        return 0
    output.write_text(serialized, encoding="utf-8")
    schemas = schema.get("components", {}).get("schemas", {})
    print(f"Wrote {output} ({len(schemas)} schemas)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
