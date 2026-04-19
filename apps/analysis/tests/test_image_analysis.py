"""Tests for ``app.services.image_analysis.run_analysis``.

Exercises the happy path (storage → vision → parse → score) and the two
degradation paths (storage failure, vision failure) without touching the
network.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.models.analysis import (
    AnalyzeRequest,
    FindingCategory,
    FindingSeverity,
    GrowContext,
)
from app.services import image_analysis


def _request() -> AnalyzeRequest:
    return AnalyzeRequest(
        plant_id="plant-1",
        image_id="img-1",
        storage_path="g/p/1.jpg",
        grow_context=GrowContext(grow_id="grow-1", stage="vegetative"),
    )


class _FakeChoiceMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeChoice:
    def __init__(self, content: str) -> None:
        self.message = _FakeChoiceMessage(content)


class _FakeCompletions:
    def __init__(self, content: str) -> None:
        self._content = content
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:  # noqa: ANN401
        self.calls.append(kwargs)
        return type(
            "Resp",
            (),
            {"choices": [_FakeChoice(self._content)]},
        )


class _FakeChat:
    def __init__(self, content: str) -> None:
        self.completions = _FakeCompletions(content)


class _FakeClient:
    def __init__(self, content: str) -> None:
        self.chat = _FakeChat(content)


@pytest.mark.asyncio
async def test_run_analysis_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_fetch(path: str, timeout_s: float = 20.0) -> bytes:
        return b"\x89PNG\r\n\x1a\nfake"

    monkeypatch.setattr(image_analysis, "fetch_image_bytes", fake_fetch)

    fake_client = _FakeClient(
        json.dumps(
            {
                "overall_health_score": 85,
                "summary": "Healthy plant with mild yellowing on lower leaves.",
                "findings": [
                    {
                        "category": "nutrient_deficiency",
                        "severity": "low",
                        "title": "Early nitrogen deficiency",
                        "description": "Lower fan leaves showing mild yellowing.",
                        "recommendation": "Increase N on next feeding.",
                    }
                ],
            }
        )
    )
    monkeypatch.setattr(image_analysis, "get_openai_client", lambda: fake_client)

    response = await image_analysis.run_analysis(_request())

    assert response.plant_id == "plant-1"
    assert response.image_id == "img-1"
    assert response.summary.startswith("Healthy plant")
    assert len(response.findings) == 1
    assert response.findings[0].category == FindingCategory.nutrient_deficiency
    assert response.findings[0].severity == FindingSeverity.low
    # Score blends model + computed scores. Weight penalty for one "low" finding = 5,
    # so computed = 95; model = 85; blended average = 90.0.
    assert response.overall_health_score == pytest.approx(90.0)
    assert response.model_version == image_analysis.MODEL_VERSION


@pytest.mark.asyncio
async def test_run_analysis_storage_failure_returns_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def failing_fetch(path: str, timeout_s: float = 20.0) -> bytes:
        raise image_analysis.StorageFetchError("not found")

    monkeypatch.setattr(image_analysis, "fetch_image_bytes", failing_fetch)

    response = await image_analysis.run_analysis(_request())

    assert response.model_version == image_analysis.FALLBACK_MODEL_VERSION
    assert response.summary
    assert len(response.findings) >= 1
    # Does not leak error details in the user-facing summary.
    assert "not found" not in response.summary


@pytest.mark.asyncio
async def test_run_analysis_vision_failure_returns_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(path: str, timeout_s: float = 20.0) -> bytes:
        return b"bytes"

    monkeypatch.setattr(image_analysis, "fetch_image_bytes", fake_fetch)

    class _BoomCompletions:
        async def create(self, **kwargs: Any) -> Any:  # noqa: ANN401
            raise RuntimeError("openai down")

    class _BoomClient:
        class chat:  # noqa: N801
            completions = _BoomCompletions()

    monkeypatch.setattr(image_analysis, "get_openai_client", lambda: _BoomClient())

    response = await image_analysis.run_analysis(_request())

    assert response.model_version == image_analysis.FALLBACK_MODEL_VERSION
    assert response.findings


@pytest.mark.asyncio
async def test_run_analysis_malformed_json_returns_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(path: str, timeout_s: float = 20.0) -> bytes:
        return b"bytes"

    monkeypatch.setattr(image_analysis, "fetch_image_bytes", fake_fetch)
    monkeypatch.setattr(
        image_analysis, "get_openai_client", lambda: _FakeClient("not json")
    )

    response = await image_analysis.run_analysis(_request())
    assert response.model_version == image_analysis.FALLBACK_MODEL_VERSION


@pytest.mark.asyncio
async def test_run_analysis_accepts_fenced_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(path: str, timeout_s: float = 20.0) -> bytes:
        return b"bytes"

    monkeypatch.setattr(image_analysis, "fetch_image_bytes", fake_fetch)
    monkeypatch.setattr(
        image_analysis,
        "get_openai_client",
        lambda: _FakeClient(
            """```json
{"overall_health_score": 82, "summary": "Stable canopy.", "findings": []}
```"""
        ),
    )

    response = await image_analysis.run_analysis(_request())

    assert response.model_version == image_analysis.MODEL_VERSION
    assert response.summary == "Stable canopy."


@pytest.mark.asyncio
async def test_run_analysis_coerces_unknown_category(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(path: str, timeout_s: float = 20.0) -> bytes:
        return b"bytes"

    monkeypatch.setattr(image_analysis, "fetch_image_bytes", fake_fetch)
    monkeypatch.setattr(
        image_analysis,
        "get_openai_client",
        lambda: _FakeClient(
            json.dumps(
                {
                    "overall_health_score": 70,
                    "summary": "ok",
                    "findings": [
                        {
                            "category": "something_invalid",
                            "severity": "high",
                            "title": "Oops",
                            "description": "desc",
                        }
                    ],
                }
            )
        ),
    )

    response = await image_analysis.run_analysis(_request())
    assert response.findings[0].category == FindingCategory.general
