"""
Tests for `app.services.image_comparison`.

The implementation is currently a stub. These tests lock in the public
signature and the placeholder behaviour so any future wiring to the OpenAI
Vision API is a deliberate, observable change.
"""

from __future__ import annotations

import inspect

import pytest

from app.services import image_comparison
from app.services.image_comparison import compare_images


@pytest.mark.asyncio
async def test_compare_images_returns_string() -> None:
    result = await compare_images(
        image_id_a="img-a",
        storage_path_a="plants/p/img-a.jpg",
        image_id_b="img-b",
        storage_path_b="plants/p/img-b.jpg",
    )
    assert isinstance(result, str)
    assert result  # non-empty


@pytest.mark.asyncio
async def test_compare_images_current_stub_marker() -> None:
    """
    The stub returns a known sentinel string. When the real implementation
    lands this test should be replaced — its failure is the intended signal.
    """
    result = await compare_images("a", "p/a", "b", "p/b")
    assert "not yet implemented" in result.lower()


def test_compare_images_signature_is_stable() -> None:
    """
    The signature is part of the internal contract used by `image_analysis`.
    Renames here must be coordinated with that caller.
    """
    sig = inspect.signature(compare_images)
    assert list(sig.parameters) == [
        "image_id_a",
        "storage_path_a",
        "image_id_b",
        "storage_path_b",
    ]


def test_compare_images_is_coroutine_function() -> None:
    assert inspect.iscoroutinefunction(image_comparison.compare_images)
