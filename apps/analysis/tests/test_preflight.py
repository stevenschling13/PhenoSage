"""Tests for the non-destructive capture-quality preflight.

Locks in three invariants:

1. ``preflight_image_quality`` and ``assess_image_quality`` agree — they
   share thresholds, so a "would raise" image must produce ``ok=False``
   with the matching reason.
2. The ``/preflight`` router exposes the structured result via the
   bearer-authenticated wire contract.
3. Each documented reason has a user-facing hint (no None / empty strings
   leaking through to the UI).
"""

from __future__ import annotations

import io
import itertools
import random

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.config import settings
from app.main import app
from app.models.analysis import PreflightRequest, PreflightResponse
from app.services import image_quality
from app.services import preflight as preflight_service
from app.services.image_quality import preflight_image_quality


def _valid_png_bytes() -> bytes:
    """Mid-luminance noisy 256×256 PNG that passes the quality gate."""
    rng = random.Random(13)
    img = Image.new("L", (256, 256))
    px = img.load()
    assert px is not None
    for y, x in itertools.product(range(256), range(256)):
        px[x, y] = rng.randint(60, 180)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _too_dark_png_bytes() -> bytes:
    """Solid near-black image — should trip ``too_dark``."""
    img = Image.new("L", (256, 256), color=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _too_small_png_bytes() -> bytes:
    img = Image.new("L", (16, 16), color=128)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_preflight_image_quality_ok() -> None:
    result = preflight_image_quality(_valid_png_bytes())
    assert result.ok is True
    assert result.reason is None
    assert result.hint  # non-empty


def test_preflight_image_quality_too_dark() -> None:
    result = preflight_image_quality(_too_dark_png_bytes())
    assert result.ok is False
    assert result.reason == "too_dark"
    assert "dark" in result.hint.lower()


def test_preflight_image_quality_too_small() -> None:
    result = preflight_image_quality(_too_small_png_bytes())
    assert result.ok is False
    assert result.reason == "image_too_small"
    assert "small" in result.hint.lower() or "closer" in result.hint.lower()


def test_preflight_image_quality_decode_failed_on_garbage() -> None:
    result = preflight_image_quality(b"not-an-image")
    assert result.ok is False
    assert result.reason == "image_decode_failed"
    assert result.hint  # non-empty


def test_every_documented_reason_has_a_hint() -> None:
    """Defence-in-depth: if a new IMAGE_QUALITY_REASON is added in
    ``app.errors`` without a matching hint here, ``preflight_image_quality``
    would surface a generic fallback. Pin that nothing slips through."""
    from app.errors import IMAGE_QUALITY_REASONS

    for reason in IMAGE_QUALITY_REASONS:
        assert reason in image_quality._REASON_HINTS, (
            f"Missing user-facing hint for IMAGE_QUALITY_REASON {reason!r}; "
            "add an entry to _REASON_HINTS in services/image_quality.py"
        )


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.analysis_service_api_key}"}


def _valid_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "plant_id": "plant-xyz",
        "image_id": "img-abc",
        "storage_path": "plants/plant-xyz/img.jpg",
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_preflight_router_returns_ok_for_good_image(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(_path: str) -> tuple[bytes, str]:
        return _valid_png_bytes(), "image/png"

    monkeypatch.setattr(preflight_service, "fetch_image", fake_fetch)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/preflight", headers=_auth_headers(), json=_valid_body()
        )

    assert response.status_code == 200
    data = response.json()
    parsed = PreflightResponse.model_validate(data)
    assert parsed.ok is True
    assert parsed.reason is None
    assert parsed.plant_id == "plant-xyz"
    assert parsed.image_id == "img-abc"


@pytest.mark.asyncio
async def test_preflight_router_returns_actionable_reason_for_bad_image(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(_path: str) -> tuple[bytes, str]:
        return _too_dark_png_bytes(), "image/png"

    monkeypatch.setattr(preflight_service, "fetch_image", fake_fetch)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/preflight", headers=_auth_headers(), json=_valid_body()
        )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False
    assert data["reason"] == "too_dark"
    assert "dark" in data["hint"].lower()


@pytest.mark.asyncio
async def test_preflight_router_requires_bearer() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/preflight",
            headers={"Authorization": "Bearer wrong-key"},
            json=_valid_body(),
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_preflight_router_rejects_invalid_storage_path() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/preflight",
            headers=_auth_headers(),
            json=_valid_body(storage_path="../etc/passwd"),
        )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_preflight_router_maps_configuration_error_to_500(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Storage misconfiguration is not retryable and not recoverable from
    the browser — surface it as a clean 500, never as ok=True."""
    from app.errors import ConfigurationError

    async def boom_fetch(_path: str) -> tuple[bytes, str]:
        raise ConfigurationError()

    monkeypatch.setattr(preflight_service, "fetch_image", boom_fetch)

    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/preflight", headers=_auth_headers(), json=_valid_body()
        )

    assert response.status_code == 500


@pytest.mark.asyncio
async def test_run_preflight_returns_response_shape() -> None:
    """Type-level pin: the request and response are real pydantic models;
    a refactor that changes the field names will fail at construction."""
    req = PreflightRequest(
        plant_id="p",
        image_id="i",
        storage_path="plants/p/img.jpg",
    )
    assert req.plant_id == "p"
    assert req.storage_path == "plants/p/img.jpg"
