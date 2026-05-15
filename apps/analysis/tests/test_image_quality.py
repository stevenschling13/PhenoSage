"""Tests for the pre-vision image quality gate.

The gate exists to satisfy the plant-health output discipline: an image we
can't reliably analyse must produce an explicit *inconclusive* result, never
a low-confidence diagnosis dressed up as a finding. See
`.github/copilot-instructions.md` §9.

Each test pins one of the well-defined inconclusive reasons exposed in
`ImageQualityInconclusive.reason` so the contract surface (which the cron
and web proxy log) is stable.
"""

from __future__ import annotations

import io
import itertools
import random

import pytest
from PIL import Image, ImageFilter

from app.errors import ImageQualityInconclusive
from app.services import image_quality


def _png_bytes(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _sharp_checker(size: int = 256) -> Image.Image:
    img = Image.new("L", (size, size), 255)
    px = img.load()
    assert px is not None
    for y, x in itertools.product(range(size), range(size)):
        if (x // 8 + y // 8) % 2 == 0:
            px[x, y] = 0
    return img


def _noisy_photo(size: int = 256, low: int = 60, high: int = 180) -> Image.Image:
    """Mid-luminance random noise — proxies an in-focus plant photo."""
    rng = random.Random(1)
    img = Image.new("L", (size, size))
    px = img.load()
    assert px is not None
    for y in range(size):
        for x in range(size):
            px[x, y] = rng.randint(low, high)
    return img


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_assess_image_quality_accepts_a_well_exposed_in_focus_photo() -> None:
    image_quality.assess_image_quality(_png_bytes(_noisy_photo()))


def test_assess_image_quality_accepts_a_sharp_checkerboard() -> None:
    # A high-contrast synthetic image is acceptable — it's just very edge-rich.
    image_quality.assess_image_quality(_png_bytes(_sharp_checker()))


def test_assess_image_quality_accepts_rgb_jpeg_input() -> None:
    rgb = _noisy_photo().convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, format="JPEG", quality=92)
    image_quality.assess_image_quality(buf.getvalue())


# ---------------------------------------------------------------------------
# Decode failures
# ---------------------------------------------------------------------------


def test_assess_image_quality_rejects_non_image_bytes() -> None:
    with pytest.raises(ImageQualityInconclusive) as exc_info:
        image_quality.assess_image_quality(b"this is not an image")
    assert exc_info.value.reason == "image_decode_failed"
    assert exc_info.value.code == "IMAGE_QUALITY_INCONCLUSIVE"


def test_assess_image_quality_rejects_empty_input() -> None:
    with pytest.raises(ImageQualityInconclusive) as exc_info:
        image_quality.assess_image_quality(b"")
    assert exc_info.value.reason == "image_decode_failed"


# ---------------------------------------------------------------------------
# Size guard
# ---------------------------------------------------------------------------


def test_assess_image_quality_rejects_images_smaller_than_minimum() -> None:
    tiny = _noisy_photo(size=32)
    with pytest.raises(ImageQualityInconclusive) as exc_info:
        image_quality.assess_image_quality(_png_bytes(tiny))
    assert exc_info.value.reason == "image_too_small"


# ---------------------------------------------------------------------------
# Luminance guards
# ---------------------------------------------------------------------------


def test_assess_image_quality_rejects_underexposed_images() -> None:
    dark = Image.new("L", (256, 256), 5)
    with pytest.raises(ImageQualityInconclusive) as exc_info:
        image_quality.assess_image_quality(_png_bytes(dark))
    assert exc_info.value.reason == "too_dark"


def test_assess_image_quality_rejects_overexposed_images() -> None:
    bright = Image.new("L", (256, 256), 250)
    with pytest.raises(ImageQualityInconclusive) as exc_info:
        image_quality.assess_image_quality(_png_bytes(bright))
    assert exc_info.value.reason == "too_bright"


# ---------------------------------------------------------------------------
# Blur guard
# ---------------------------------------------------------------------------


def test_assess_image_quality_rejects_blurred_photos() -> None:
    blurred = _noisy_photo().filter(ImageFilter.GaussianBlur(radius=8))
    with pytest.raises(ImageQualityInconclusive) as exc_info:
        image_quality.assess_image_quality(_png_bytes(blurred))
    assert exc_info.value.reason == "too_blurry"


def test_assess_image_quality_rejects_uniform_grey_as_blurry() -> None:
    # Uniform grey is in-bounds for luminance but contains zero edge
    # information. The user-facing reason is "too_blurry" — the most
    # actionable copy ("retake the photo, this one is featureless").
    flat = Image.new("L", (256, 256), 128)
    with pytest.raises(ImageQualityInconclusive) as exc_info:
        image_quality.assess_image_quality(_png_bytes(flat))
    assert exc_info.value.reason == "too_blurry"


# ---------------------------------------------------------------------------
# Reason ordering — the most specific reason wins
# ---------------------------------------------------------------------------


def test_dark_image_reports_too_dark_not_too_blurry() -> None:
    # A uniformly black image has zero luminance AND zero edge content.
    # Operators want the more specific exposure copy, not "blurry".
    dark = Image.new("L", (256, 256), 0)
    with pytest.raises(ImageQualityInconclusive) as exc_info:
        image_quality.assess_image_quality(_png_bytes(dark))
    assert exc_info.value.reason == "too_dark"


# ---------------------------------------------------------------------------
# Contract surface
# ---------------------------------------------------------------------------


def test_image_quality_inconclusive_default_is_redaction_safe() -> None:
    err = ImageQualityInconclusive(reason="too_blurry")
    assert err.code == "IMAGE_QUALITY_INCONCLUSIVE"
    assert err.status_code == 422
    assert err.retryable is False
    msg = err.default_message.lower()
    # Never embed pixel-level numbers, file paths, or provider text.
    assert "pillow" not in msg
    assert "supabase" not in msg
    assert "openai" not in msg


def test_image_quality_inconclusive_rejects_unknown_reason() -> None:
    with pytest.raises(ValueError):
        ImageQualityInconclusive(reason="nope")  # type: ignore[arg-type]
