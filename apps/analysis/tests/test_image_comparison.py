"""Tests for `app.services.image_comparison`.

The service was previously a ``NotImplementedError`` stub; these tests
exercise the real two-image comparison path by patching the storage fetch
and OpenAI call seams. Network and pixel-level dependencies are avoided
so the suite stays fast and deterministic.
"""

from __future__ import annotations

import io
import itertools
import json
import random
import sys
from types import SimpleNamespace

import pytest
from PIL import Image

from app.config import settings
from app.errors import ModelUnavailable, StorageUnavailable
from app.models.analysis import (
    CompareRequest,
    CompareResponse,
    GrowContext,
    UniformityDelta,
)
from app.services import image_comparison


def _valid_png_bytes() -> bytes:
    """Mid-luminance noisy 256×256 PNG that passes ``assess_image_quality``."""
    rng = random.Random(7)
    img = Image.new("L", (256, 256))
    px = img.load()
    assert px is not None
    for y, x in itertools.product(range(256), range(256)):
        px[x, y] = rng.randint(60, 180)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _request() -> CompareRequest:
    return CompareRequest(
        plant_id="plant-1",
        image_id_current="img-current",
        storage_path_current="plants/plant-1/img-current.jpg",
        image_id_previous="img-previous",
        storage_path_previous="plants/plant-1/img-previous.jpg",
        grow_context=GrowContext(grow_id="grow-1", strain="Blue Dream"),
    )


def _install_fake_openai(
    monkeypatch: pytest.MonkeyPatch,
    *,
    raw_content: str | None = None,
    raise_exc: BaseException | None = None,
) -> None:
    """Install a fake ``openai`` module so ``_call_vision_model`` can run
    without the real SDK. ``raw_content`` becomes the model's JSON; if
    ``raise_exc`` is set, the call raises that exception instead."""

    class FakeMessage:
        def __init__(self, content: str) -> None:
            self.content = content

    class FakeChoice:
        def __init__(self, content: str) -> None:
            self.message = FakeMessage(content)

    class FakeCompletion:
        def __init__(self, content: str) -> None:
            self.choices = [FakeChoice(content)]

    class FakeCompletions:
        async def create(self, **_kwargs: object) -> FakeCompletion:
            if raise_exc is not None:
                raise raise_exc
            assert raw_content is not None
            return FakeCompletion(raw_content)

    class FakeChat:
        def __init__(self) -> None:
            self.completions = FakeCompletions()

    class FakeAsyncOpenAI:
        def __init__(self, *, api_key: str) -> None:  # noqa: D401
            assert api_key
            self.chat = FakeChat()

    monkeypatch.setitem(
        sys.modules,
        "openai",
        SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI),
    )


@pytest.mark.asyncio
async def test_compare_images_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    async def fake_fetch(storage_path: str) -> tuple[bytes, str]:
        return _valid_png_bytes(), "image/png"

    monkeypatch.setattr(image_comparison, "fetch_image", fake_fetch)
    _install_fake_openai(
        monkeypatch,
        raw_content=json.dumps(
            {
                "summary": "Canopy darker, more flower sites.",
                "bullets": [
                    "Leaves darker green than the previous capture.",
                    "Visible new flower sites in the upper canopy.",
                ],
                "uniformity_delta": "improved",
                "confidence": 0.82,
            }
        ),
    )

    response = await image_comparison.compare_images(_request())

    assert isinstance(response, CompareResponse)
    assert response.is_fallback is False
    assert response.analysis_mode == "model"
    assert response.summary == "Canopy darker, more flower sites."
    assert len(response.bullets) == 2
    assert response.bullets[0].startswith("Leaves darker green")
    assert response.uniformity_delta == UniformityDelta.improved
    assert response.confidence == pytest.approx(0.82)


@pytest.mark.asyncio
async def test_compare_images_clamps_confidence_and_caps_bullets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Defence-in-depth: a misbehaving model can't pollute confidence
    (>1) or flood the UI with 20 bullets."""
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    async def fake_fetch(storage_path: str) -> tuple[bytes, str]:
        return _valid_png_bytes(), "image/png"

    monkeypatch.setattr(image_comparison, "fetch_image", fake_fetch)
    _install_fake_openai(
        monkeypatch,
        raw_content=json.dumps(
            {
                "summary": "Lots changed.",
                "bullets": [f"Change {i}" for i in range(20)],
                "uniformity_delta": "improved",
                "confidence": 5.5,
            }
        ),
    )

    response = await image_comparison.compare_images(_request())

    assert len(response.bullets) == 5  # capped
    assert response.confidence == 1.0  # clamped


@pytest.mark.asyncio
async def test_compare_images_invalid_uniformity_becomes_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    async def fake_fetch(storage_path: str) -> tuple[bytes, str]:
        return _valid_png_bytes(), "image/png"

    monkeypatch.setattr(image_comparison, "fetch_image", fake_fetch)
    _install_fake_openai(
        monkeypatch,
        raw_content=json.dumps(
            {
                "summary": "Test.",
                "bullets": ["one"],
                "uniformity_delta": "nonsense-value",
                "confidence": 0.5,
            }
        ),
    )

    response = await image_comparison.compare_images(_request())
    assert response.uniformity_delta == UniformityDelta.unknown


@pytest.mark.asyncio
async def test_compare_images_empty_bullets_get_placeholder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Empty list from the model becomes a single "no change detected"
    line so the UI never renders a silent 0-bullet result."""
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    async def fake_fetch(storage_path: str) -> tuple[bytes, str]:
        return _valid_png_bytes(), "image/png"

    monkeypatch.setattr(image_comparison, "fetch_image", fake_fetch)
    _install_fake_openai(
        monkeypatch,
        raw_content=json.dumps(
            {
                "summary": "",
                "bullets": [],
                "uniformity_delta": "unchanged",
                "confidence": 0.2,
            }
        ),
    )

    response = await image_comparison.compare_images(_request())
    assert len(response.bullets) == 1
    assert "no visible change" in response.bullets[0].lower()
    # Empty summary string falls back to the canned "comparison completed
    # but the summary was incomplete." sentence.
    assert response.summary.startswith("Comparison completed")


@pytest.mark.asyncio
async def test_compare_images_falls_back_when_storage_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    async def boom_fetch(storage_path: str) -> tuple[bytes, str]:
        raise StorageUnavailable("simulated outage")

    monkeypatch.setattr(image_comparison, "fetch_image", boom_fetch)

    # Skip the retry backoff sleeps so this test stays under a millisecond.
    async def no_sleep(_seconds: float) -> None:
        return None

    from app.services import retry as retry_module

    monkeypatch.setattr(retry_module, "_DEFAULT_SLEEP", no_sleep)

    response = await image_comparison.compare_images(_request())

    assert response.is_fallback is True
    assert response.analysis_mode == "fallback"
    assert response.fallback_reason == "STORAGE_UNAVAILABLE"
    assert response.uniformity_delta == UniformityDelta.unknown
    assert response.confidence == 0.0


@pytest.mark.asyncio
async def test_compare_images_falls_back_when_model_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    async def fake_fetch(storage_path: str) -> tuple[bytes, str]:
        return _valid_png_bytes(), "image/png"

    monkeypatch.setattr(image_comparison, "fetch_image", fake_fetch)
    _install_fake_openai(
        monkeypatch,
        raise_exc=ModelUnavailable("model down"),
    )

    response = await image_comparison.compare_images(_request())
    assert response.is_fallback is True
    assert response.fallback_reason == "MODEL_UNAVAILABLE"


@pytest.mark.asyncio
async def test_compare_images_falls_back_when_openai_key_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "")

    async def fake_fetch(storage_path: str) -> tuple[bytes, str]:
        return _valid_png_bytes(), "image/png"

    monkeypatch.setattr(image_comparison, "fetch_image", fake_fetch)

    response = await image_comparison.compare_images(_request())
    assert response.is_fallback is True
    assert response.fallback_reason == "CONFIGURATION_ERROR"


def test_storage_path_validators_reject_traversal() -> None:
    with pytest.raises(Exception):
        CompareRequest(
            plant_id="p",
            image_id_current="c",
            storage_path_current="../etc/passwd",
            image_id_previous="p2",
            storage_path_previous="plants/p/img.jpg",
            grow_context=GrowContext(grow_id="g"),
        )
    with pytest.raises(Exception):
        CompareRequest(
            plant_id="p",
            image_id_current="c",
            storage_path_current="plants/p/img.jpg",
            image_id_previous="p2",
            storage_path_previous="/absolute/path.jpg",
            grow_context=GrowContext(grow_id="g"),
        )
