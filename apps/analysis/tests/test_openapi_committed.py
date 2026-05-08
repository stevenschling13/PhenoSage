"""
Guard test: the committed `openapi.json` must equal what the live
FastAPI app produces right now.

If a developer changes a Pydantic model in `app/models/**` without
re-running `python3 scripts/export_openapi.py`, this test fails with
the exact diff so they know to commit the regenerated file.

The TS-side check (`scripts/check-contract-sync.mjs`) keys off the
committed openapi.json — so this test prevents that file from going
stale.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.main import app

ROOT = Path(__file__).resolve().parents[1]
OPENAPI = ROOT / "openapi.json"


def _serialize(schema: dict) -> str:
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


def test_openapi_committed_is_in_sync() -> None:
    if not OPENAPI.exists():
        pytest.fail(
            f"{OPENAPI} is missing. Generate it with:\n"
            "    cd apps/analysis && python3 scripts/export_openapi.py"
        )

    actual = _serialize(app.openapi())
    committed = OPENAPI.read_text(encoding="utf-8")

    if actual == committed:
        return

    # Show a short, actionable hint instead of the full multi-KB diff —
    # contributors regenerate, not patch by hand.
    pytest.fail(
        "openapi.json is out of sync with the live FastAPI app.\n"
        "Regenerate with:\n"
        "    cd apps/analysis && python3 scripts/export_openapi.py\n"
        "Then commit the updated apps/analysis/openapi.json."
    )
