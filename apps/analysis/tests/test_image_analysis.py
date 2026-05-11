from __future__ import annotations

import json
import sys
from types import SimpleNamespace

import pytest

from app.config import settings
from app.models.analysis import AnalyzeRequest
from app.services import image_analysis


def _request() -> AnalyzeRequest:
    return AnalyzeRequest(
        plant_id="plant-1",
        image_id="image-1",
        storage_path="plants/plant-1/image.jpg",
        grow_context={"grow_id": "grow-1", "strain": "Blue Dream"},
        previous_image_id="previous-image",
    )


@pytest.mark.asyncio
async def test_run_analysis_returns_inconclusive_fallback_when_storage_is_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_service_role_key", "")

    response = await image_analysis.run_analysis(_request())

    assert response.analysis_mode == "fallback"
    assert response.is_fallback is True
    assert response.fallback_reason == "RuntimeError"
    assert response.overall_health_score == 0.0
    assert "Inconclusive fallback result" in response.summary
    assert response.compared_to_image_id == "previous-image"
    assert response.findings[0].title == "Fallback analysis only"


@pytest.mark.asyncio
async def test_run_model_analysis_parses_structured_model_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            assert kwargs["model"] == image_analysis.MODEL_VERSION
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps(
                                {
                                    "overall_health_score": 74,
                                    "summary": "Mild deficiency detected.",
                                    "findings": [
                                        {
                                            "category": "nutrient_deficiency",
                                            "severity": "medium",
                                            "title": "Magnesium deficiency",
                                            "description": "Interveinal chlorosis.",
                                            "recommendation": "Add Cal-Mag.",
                                        }
                                    ],
                                }
                            )
                        )
                    )
                ]
            )

    class FakeAsyncOpenAI:
        def __init__(self, *, api_key: str) -> None:
            assert api_key == "sk-test"
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(
        sys.modules,
        "openai",
        SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI),
    )

    response = await image_analysis._run_model_analysis(
        _request(),
        image_bytes=b"fake-image",
        content_type="image/jpeg",
    )

    assert response.analysis_mode == "model"
    assert response.is_fallback is False
    assert response.overall_health_score == 74.0
    assert response.summary == "Mild deficiency detected."
    assert response.findings[0].title == "Magnesium deficiency"
    assert response.findings[0].recommendation == "Add Cal-Mag."
    assert response.compared_to_image_id == "previous-image"


@pytest.mark.asyncio
async def test_run_model_analysis_uses_low_confidence_defaults_for_incomplete_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps(
                                {
                                    "overall_health_score": "unknown",
                                    "summary": "",
                                    "findings": [],
                                }
                            )
                        )
                    )
                ]
            )

    class FakeAsyncOpenAI:
        def __init__(self, *, api_key: str) -> None:
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(
        sys.modules,
        "openai",
        SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI),
    )

    response = await image_analysis._run_model_analysis(
        _request(),
        image_bytes=b"fake-image",
        content_type="image/png",
    )

    assert response.analysis_mode == "model"
    assert response.summary == (
        "Image reviewed successfully, but the returned summary was incomplete."
    )
    assert response.findings[0].title == "No issues confidently identified"
    assert response.overall_health_score == 100.0
