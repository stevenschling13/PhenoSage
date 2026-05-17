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
async def test_compare_images_raises_not_implemented() -> None:
    """The stub must fail loudly if it's ever called from a production path.

    Returning a placeholder string previously hid the unfinished state from
    callers. Raising ``NotImplementedError`` instead makes accidental
    wiring an observable bug rather than a silent UX defect.
    """
    with pytest.raises(NotImplementedError, match="Milestone 2"):
        await compare_images(
            image_id_a="img-a",
            storage_path_a="plants/p/img-a.jpg",
            image_id_b="img-b",
            storage_path_b="plants/p/img-b.jpg",
        )


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
