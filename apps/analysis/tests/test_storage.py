from __future__ import annotations

import pytest

from app.services import storage


@pytest.mark.parametrize(
    ("storage_path", "expected"),
    [
        ("plant-images/grow-1/plant-1/image.jpg", "grow-1/plant-1/image.jpg"),
        ("grow-1/plant-1/image.jpg", "grow-1/plant-1/image.jpg"),
    ],
)
def test_normalize_storage_path_accepts_expected_paths(
    storage_path: str, expected: str
) -> None:
    assert storage._normalize_storage_path(storage_path) == expected


@pytest.mark.parametrize(
    "storage_path",
    [
        "",
        "../etc/passwd",
        "grow-1/../plant-1/image.jpg",
        "https://evil.example/object.jpg",
        "grow-1\\plant-1\\image.jpg",
        "grow-1/plant 1/image.jpg",
    ],
)
def test_normalize_storage_path_rejects_untrusted_input(storage_path: str) -> None:
    with pytest.raises(storage.StorageFetchError):
        storage._normalize_storage_path(storage_path)
