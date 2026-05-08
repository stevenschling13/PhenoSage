"""
Image cap + MIME guard tests for the analysis service.

These guards live inside `run_analysis` and reject client-fixable
errors with HTTPException 413 / 415 — distinct from the
inconclusive-fallback path used for storage / model failures.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException

from app.config import settings
from app.models.analysis import AnalyzeRequest, GrowContext
from app.services import image_analysis
from app.services.image_analysis import _validate_image, run_analysis

# ── _validate_image direct ────────────────────────────────────────────────


def test_validate_image_accepts_known_mime_under_cap() -> None:
    _validate_image("image/jpeg", b"x" * 1024)
    _validate_image("image/png", b"x" * 1024)
    _validate_image("image/webp", b"x" * 1024)
    _validate_image("image/heic", b"x" * 1024)


def test_validate_image_strips_charset_from_content_type() -> None:
    # Real-world Content-Type can include `; charset=binary` etc.
    _validate_image("image/jpeg; charset=binary", b"x" * 16)


def test_validate_image_rejects_unsupported_mime() -> None:
    with pytest.raises(HTTPException) as excinfo:
        _validate_image("image/gif", b"x" * 16)
    assert excinfo.value.status_code == 415
    assert "image/gif" in excinfo.value.detail


def test_validate_image_rejects_oversize(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "image_max_bytes", 100)
    with pytest.raises(HTTPException) as excinfo:
        _validate_image("image/jpeg", b"x" * 200)
    assert excinfo.value.status_code == 413
    assert "200" in excinfo.value.detail


# ── End-to-end propagation through run_analysis ──────────────────────────


def _request() -> AnalyzeRequest:
    return AnalyzeRequest(
        plant_id="p1",
        image_id="img-1",
        storage_path="plants/p1/img.jpg",
        grow_context=GrowContext(grow_id="g1"),
    )


@pytest.mark.asyncio
async def test_run_analysis_propagates_415_for_unsupported_mime(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fetch_gif(path: str) -> tuple[bytes, str]:
        return b"x" * 16, "image/gif"

    monkeypatch.setattr(image_analysis, "fetch_storage_image", fetch_gif)

    def _no_client() -> Any:
        raise AssertionError("OpenAI must not be invoked when MIME is rejected")

    monkeypatch.setattr(image_analysis, "get_openai_client", _no_client)

    with pytest.raises(HTTPException) as excinfo:
        await run_analysis(_request())
    assert excinfo.value.status_code == 415


@pytest.mark.asyncio
async def test_run_analysis_propagates_413_for_oversize(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "image_max_bytes", 100)

    async def fetch_huge(path: str) -> tuple[bytes, str]:
        return b"x" * 4096, "image/jpeg"

    monkeypatch.setattr(image_analysis, "fetch_storage_image", fetch_huge)

    def _no_client() -> Any:
        raise AssertionError("OpenAI must not be invoked when size is rejected")

    monkeypatch.setattr(image_analysis, "get_openai_client", _no_client)

    with pytest.raises(HTTPException) as excinfo:
        await run_analysis(_request())
    assert excinfo.value.status_code == 413
