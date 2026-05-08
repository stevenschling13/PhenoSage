"""
Tests for `app.services.storage._validate_storage_path`.

Locks the SSRF-defense contract so a bad `storage_path` from the
Next.js proxy can never reach httpx unsanitized.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services.storage import _validate_storage_path


@pytest.mark.parametrize(
    "good_path",
    [
        "plants/p1/2026-01-01-img.jpg",
        "plants/plant-xyz/abc.png",
        "single-file.webp",
        "deep/nested/path/leaf.heic",
        "with-dots.in.name.jpeg",
    ],
)
def test_validate_storage_path_accepts_well_formed_keys(good_path: str) -> None:
    _validate_storage_path(good_path)  # no raise


@pytest.mark.parametrize(
    "bad_path",
    [
        "",
        "   ",
        "/absolute/path.jpg",
        "../escape.jpg",
        "plants/../other-bucket/file.jpg",
        "plants/./file.jpg",
        "plants//double-slash.jpg",
        "plants/p1/file.jpg?op=delete",
        "plants/p1/file.jpg#fragment",
        "plants/p1/file with space.jpg",
        "plants/p1/file\\backslash.jpg",
        "plants/p1/file\x00nul.jpg",
        "http://evil.example.com/leak.jpg",
        "plants/p1/" + "x" * 600,
    ],
)
def test_validate_storage_path_rejects_unsafe_input(bad_path: str) -> None:
    with pytest.raises(HTTPException) as excinfo:
        _validate_storage_path(bad_path)
    assert excinfo.value.status_code == 400


def test_validate_storage_path_rejects_traversal_in_any_segment() -> None:
    """`..` anywhere in the path must fail, not just at the start."""
    with pytest.raises(HTTPException) as excinfo:
        _validate_storage_path("plants/p1/../../etc/passwd")
    assert excinfo.value.status_code == 400
