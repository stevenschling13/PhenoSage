from __future__ import annotations

import inspect

import pytest

from app.models.analysis import ImageComparisonResult
from app.services import image_comparison
from app.services.image_comparison import compare_images


@pytest.mark.asyncio
async def test_compare_images_returns_structured_result(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_fetch(_: str) -> tuple[bytes, str]:
        return b"img", "image/jpeg"

    class _Create:
        async def create(self, **_: object):
            class Msg: content = '{"changes":["leaf curl reduced"],"likelyTrendDirection":"improving","confidence":0.8,"caveats":["lighting changed"]}'
            class Choice: message = Msg()
            class Resp: choices = [Choice()]
            return Resp()

    class _Client:
        chat = type("chat", (), {"completions": _Create()})

    monkeypatch.setattr(image_comparison, "_fetch_storage_image", fake_fetch)
    monkeypatch.setattr(image_comparison, "AsyncOpenAI", lambda api_key: _Client())
    monkeypatch.setattr(image_comparison.settings, "openai_api_key", "x")

    result = await compare_images("a", "p/a", "b", "p/b")
    assert isinstance(result, ImageComparisonResult)
    assert result.likely_trend_direction.value == "improving"


def test_compare_images_signature_is_stable() -> None:
    sig = inspect.signature(compare_images)
    assert list(sig.parameters) == ["image_id_a", "storage_path_a", "image_id_b", "storage_path_b"]


def test_compare_images_is_coroutine_function() -> None:
    assert inspect.iscoroutinefunction(image_comparison.compare_images)
