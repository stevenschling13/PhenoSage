"""Tests for ``app.services.image_comparison``.

The real implementation calls OpenAI Vision; these tests exercise the contract
(coroutine, stable signature, graceful degradation when storage is not
configured) without hitting the network.
"""

from __future__ import annotations

import inspect

import pytest

from app.services import image_comparison
from app.services.image_comparison import compare_images


@pytest.mark.asyncio
async def test_compare_images_returns_empty_string_without_storage() -> None:
    """Without Supabase credentials the helper degrades gracefully.

    Settings are pulled from env at process start; in the test harness they
    are empty strings, so the internal storage fetch raises and we return "".
    """
    result = await compare_images(
        image_id_a="img-a",
        storage_path_a="plants/p/img-a.jpg",
        image_id_b="img-b",
        storage_path_b="plants/p/img-b.jpg",
    )
    assert isinstance(result, str)
    assert result == ""


def test_compare_images_signature_is_stable() -> None:
    """Part of the internal contract used by ``image_analysis``."""
    sig = inspect.signature(compare_images)
    assert list(sig.parameters) == [
        "image_id_a",
        "storage_path_a",
        "image_id_b",
        "storage_path_b",
    ]


def test_compare_images_is_coroutine_function() -> None:
    assert inspect.iscoroutinefunction(image_comparison.compare_images)
