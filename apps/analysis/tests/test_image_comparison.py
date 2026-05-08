"""
Tests for `app.services.image_comparison`.

Locks the public signature, plus the wiring against the mocked
storage fetch and OpenAI client. The previous stub-sentinel test
was deleted on purpose when the real implementation landed.
"""

from __future__ import annotations

import inspect
from typing import Any

import pytest

from app.config import settings
from app.middleware import _request_id_ctx
from app.models.analysis import GrowContext
from app.services import image_comparison
from app.services.image_comparison import compare_images


@pytest.fixture(autouse=True)
def _seed_request_id():
    token = _request_id_ctx.set("rid-test")
    yield
    _request_id_ctx.reset(token)


def test_compare_images_signature_is_stable() -> None:
    sig = inspect.signature(compare_images)
    assert list(sig.parameters) == [
        "image_id_a",
        "storage_path_a",
        "image_id_b",
        "storage_path_b",
        "grow_context",
    ]
    # grow_context is optional so existing callers keep working.
    assert sig.parameters["grow_context"].default is None


def test_compare_images_is_coroutine_function() -> None:
    assert inspect.iscoroutinefunction(image_comparison.compare_images)


@pytest.mark.asyncio
async def test_compare_images_returns_summary_from_openai(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fetch_calls: list[str] = []

    async def fake_fetch(path: str) -> tuple[bytes, str]:
        fetch_calls.append(path)
        return b"fake-image", "image/jpeg"

    class FakeMessage:
        content = "Lower fan leaves yellower than previous; vigor unchanged."

    class FakeChoice:
        message = FakeMessage()

    class FakeCompletion:
        choices = [FakeChoice()]

    create_calls: list[dict[str, Any]] = []

    class FakeCompletions:
        async def create(self, **kwargs: Any) -> FakeCompletion:
            create_calls.append(kwargs)
            return FakeCompletion()

    class FakeChat:
        def __init__(self) -> None:
            self.completions = FakeCompletions()

    class FakeClient:
        def __init__(self) -> None:
            self.chat = FakeChat()

    monkeypatch.setattr(image_comparison, "fetch_storage_image", fake_fetch)
    monkeypatch.setattr(image_comparison, "get_openai_client", lambda: FakeClient())

    result = await compare_images(
        image_id_a="img-prev",
        storage_path_a="plants/p/prev.jpg",
        image_id_b="img-curr",
        storage_path_b="plants/p/curr.jpg",
        grow_context=GrowContext(grow_id="grow-1", strain="Blue Dream"),
    )

    assert isinstance(result, str)
    assert "yellower" in result.lower()
    # Both images were fetched, in order.
    assert fetch_calls == ["plants/p/prev.jpg", "plants/p/curr.jpg"]
    # OpenAI got called once with both images included.
    assert len(create_calls) == 1
    user_message = create_calls[0]["messages"][1]
    contents = user_message["content"]
    text_blocks = [c for c in contents if c.get("type") == "text"]
    assert any(b["text"] == "PREVIOUS:" for b in text_blocks)
    assert any(b["text"] == "CURRENT:" for b in text_blocks)


@pytest.mark.asyncio
async def test_compare_images_skips_when_image_too_large(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Pretend the cap is 100 bytes for this test.
    monkeypatch.setattr(settings, "image_max_bytes", 100)

    async def fake_fetch_oversize(path: str) -> tuple[bytes, str]:
        return b"x" * 200, "image/jpeg"

    monkeypatch.setattr(image_comparison, "fetch_storage_image", fake_fetch_oversize)

    # OpenAI client should never be called when we skip.
    def _no_client() -> Any:
        raise AssertionError("OpenAI client should not be invoked when over cap")

    monkeypatch.setattr(image_comparison, "get_openai_client", _no_client)

    result = await compare_images(
        image_id_a="a",
        storage_path_a="p/a",
        image_id_b="b",
        storage_path_b="p/b",
    )

    assert "skipped" in result.lower()
