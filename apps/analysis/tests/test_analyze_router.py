"""
Tests for the /analyze router that exercise non-stub behaviour by
monkey-patching `run_analysis` (the seam where OpenAI Vision will be wired).

These tests assert the router's wiring contract:
  - It awaits whatever `run_analysis` returns and serializes it through the
    `AnalyzeResponse` Pydantic model.
  - It propagates plant/image identifiers from the request.
  - The serialized response shape matches `AnalyzeResponse` and, by extension,
    the shared TypeScript contract in `packages/shared/src/types.ts`.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app
from app.models.analysis import (
    AnalysisFinding,
    AnalyzeRequest,
    AnalyzeResponse,
    CompareRequest,
    CompareResponse,
    FindingCategory,
    FindingSeverity,
    UniformityDelta,
)
from app.routers import analyze as analyze_router_module


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.analysis_service_api_key}"}


def _valid_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "plant_id": "plant-xyz",
        "image_id": "img-abc",
        "storage_path": "plants/plant-xyz/2026-01-01-img.jpg",
        "grow_context": {
            "grow_id": "grow-1",
            "strain": "Blue Dream",
            "stage": "vegetative",
        },
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_router_returns_payload_from_injected_run_analysis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The router must serialize whatever `run_analysis` returns."""
    captured: dict[str, AnalyzeRequest] = {}

    async def fake_run_analysis(request: AnalyzeRequest) -> AnalyzeResponse:
        captured["request"] = request
        return AnalyzeResponse(
            plant_id=request.plant_id,
            image_id=request.image_id,
            overall_health_score=82.5,
            summary="Healthy plant with mild nitrogen deficiency.",
            findings=[
                AnalysisFinding(
                    category=FindingCategory.nutrient_deficiency,
                    severity=FindingSeverity.low,
                    title="Mild nitrogen deficiency",
                    description="Lower fan leaves yellowing.",
                    recommendation="Increase N in next feeding.",
                ),
            ],
            compared_to_image_id=None,
            comparison_summary=None,
            analyzed_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC),
            model_version="gpt-4o-test-1.0",
        )

    monkeypatch.setattr(analyze_router_module, "run_analysis", fake_run_analysis)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/analyze", headers=_auth_headers(), json=_valid_body()
        )

    assert response.status_code == 200
    data = response.json()

    # Identifiers propagate.
    assert data["plant_id"] == "plant-xyz"
    assert data["image_id"] == "img-abc"

    # Injected payload is reflected verbatim.
    assert data["overall_health_score"] == 82.5
    assert data["summary"].startswith("Healthy plant")
    assert data["model_version"] == "gpt-4o-test-1.0"
    assert len(data["findings"]) == 1
    finding = data["findings"][0]
    assert finding["category"] == "nutrient_deficiency"
    assert finding["severity"] == "low"
    assert finding["recommendation"] == "Increase N in next feeding."

    # The request the router forwarded matches the body we sent.
    assert captured["request"].plant_id == "plant-xyz"
    assert captured["request"].grow_context.grow_id == "grow-1"
    assert captured["request"].grow_context.strain == "Blue Dream"


@pytest.mark.asyncio
async def test_router_propagates_previous_image_for_comparison(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When `previous_image_id` is supplied, the router must pass it through."""

    async def fake_run_analysis(request: AnalyzeRequest) -> AnalyzeResponse:
        return AnalyzeResponse(
            plant_id=request.plant_id,
            image_id=request.image_id,
            overall_health_score=90.0,
            summary="Improved versus previous image.",
            findings=[
                AnalysisFinding(
                    category=FindingCategory.positive,
                    severity=FindingSeverity.info,
                    title="Improvement",
                    description="Yellowing reduced versus previous image.",
                ),
            ],
            compared_to_image_id=request.previous_image_id,
            comparison_summary="Less leaf yellowing than yesterday.",
            analyzed_at=datetime(2026, 1, 2, 0, 0, 0, tzinfo=UTC),
            model_version="gpt-4o-test-1.0",
        )

    monkeypatch.setattr(analyze_router_module, "run_analysis", fake_run_analysis)

    body = _valid_body(
        previous_image_id="img-prev",
        previous_storage_path="plants/plant-xyz/2025-12-31-img.jpg",
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/analyze", headers=_auth_headers(), json=body)

    assert response.status_code == 200
    data = response.json()
    assert data["compared_to_image_id"] == "img-prev"
    assert data["comparison_summary"] == "Less leaf yellowing than yesterday."


@pytest.mark.asyncio
async def test_router_500s_when_run_analysis_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Internal failures must not leak as 200; FastAPI converts to 500."""

    async def boom(request: AnalyzeRequest) -> AnalyzeResponse:
        raise RuntimeError("openai exploded")

    monkeypatch.setattr(analyze_router_module, "run_analysis", boom)

    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/analyze", headers=_auth_headers(), json=_valid_body()
        )

    assert response.status_code == 500


def _valid_compare_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "plant_id": "plant-xyz",
        "image_id_current": "img-current",
        "storage_path_current": "plants/plant-xyz/img-current.jpg",
        "image_id_previous": "img-previous",
        "storage_path_previous": "plants/plant-xyz/img-previous.jpg",
        "grow_context": {
            "grow_id": "grow-1",
            "strain": "Blue Dream",
            "stage": "flower",
        },
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_compare_router_serializes_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, CompareRequest] = {}

    async def fake_compare(request: CompareRequest) -> CompareResponse:
        captured["request"] = request
        return CompareResponse(
            plant_id=request.plant_id,
            image_id_current=request.image_id_current,
            image_id_previous=request.image_id_previous,
            summary="Visible flower development in the upper canopy.",
            bullets=[
                "New flower sites in the top third of the canopy.",
                "Leaves a touch darker than the prior capture.",
            ],
            uniformity_delta=UniformityDelta.improved,
            confidence=0.78,
            analyzed_at=datetime(2026, 5, 19, 0, 0, 0, tzinfo=UTC),
            model_version="gpt-4o-test-1.0",
            analysis_mode="model",
            is_fallback=False,
        )

    monkeypatch.setattr(analyze_router_module, "compare_images", fake_compare)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/compare", headers=_auth_headers(), json=_valid_compare_body()
        )

    assert response.status_code == 200
    data = response.json()
    assert data["plant_id"] == "plant-xyz"
    assert data["image_id_current"] == "img-current"
    assert data["image_id_previous"] == "img-previous"
    assert data["uniformity_delta"] == "improved"
    assert data["confidence"] == 0.78
    assert len(data["bullets"]) == 2
    assert data["is_fallback"] is False
    assert captured["request"].grow_context.strain == "Blue Dream"


@pytest.mark.asyncio
async def test_compare_router_requires_bearer() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/compare",
            headers={"Authorization": "Bearer wrong-key"},
            json=_valid_compare_body(),
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_compare_router_rejects_invalid_storage_path() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/compare",
            headers=_auth_headers(),
            json=_valid_compare_body(storage_path_current="../etc/passwd"),
        )
    assert response.status_code == 422
