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
# Magic-bytes pre-decode guard (Phase 5.2)
#
# These tests pin the defence-in-depth contract: bytes whose prefix doesn't
# match a known image format never reach Pillow's parsers. Pillow / libjpeg
# / libwebp have shipped parser CVEs in the past — cutting off non-image
# payloads at the boundary keeps the attack surface narrow.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("label", "payload"),
    [
        # A PDF labelled image/png in transit. Common mislabelling /
        # attack-staging pattern: PDFs have a complex parser surface
        # of their own and shouldn't be fed to an image decoder.
        ("pdf", b"%PDF-1.7\n%abc\n"),
        # ZIP archives (and the Office formats built on them).
        ("zip", b"PK\x03\x04abcdefghijkl"),
        # ELF binaries — would only appear in an active exploit
        # attempt but worth proving we refuse them.
        ("elf", b"\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00"),
        # Plain text mislabelled as image/png.
        ("text", b"hello world this is not an image"),
        # 11 bytes — below the 12-byte minimum the sniffer needs.
        ("too_short", b"\xff\xd8\xff" + b"\x00" * 8),
    ],
)
def test_assess_image_quality_rejects_non_image_magic_bytes(
    label: str, payload: bytes
) -> None:
    """Pre-decode magic-bytes check refuses bytes that aren't a known image."""
    _ = label  # kept in the parametrize label for diagnostic output
    with pytest.raises(ImageQualityInconclusive) as exc_info:
        image_quality.assess_image_quality(payload)
    assert exc_info.value.reason == "image_decode_failed"


def test_magic_bytes_accepts_jpeg_signature() -> None:
    # The full image would still need to pass the other quality
    # heuristics (size, luminance, edge variance) to reach the
    # vision model — we only assert that the magic-bytes layer
    # doesn't block a real JPEG prefix here. Pillow's decoder will
    # legitimately raise UnidentifiedImageError / OSError on the
    # truncated payload, which collapses to the same
    # `image_decode_failed` reason; the test below confirms the
    # signature itself is recognised by exercising the private
    # helper directly so we're not coupled to Pillow's behaviour.
    assert image_quality._looks_like_known_image(b"\xff\xd8\xff" + b"\x00" * 12)


def test_magic_bytes_accepts_each_supported_format() -> None:
    """Pin every format the upload route declares we accept."""
    # JPEG SOI marker.
    assert image_quality._looks_like_known_image(b"\xff\xd8\xff\xe0" + b"\x00" * 10)
    # PNG fixed 8-byte signature.
    assert image_quality._looks_like_known_image(
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
    )
    # WebP: RIFF + 4-byte length + WEBP.
    assert image_quality._looks_like_known_image(b"RIFF\x00\x00\x00\x00WEBP")
    # HEIC ftyp brands the upload route claims to accept. The 4-byte
    # box-size prefix is whatever — Pillow validates that downstream.
    for brand in (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"):
        assert image_quality._looks_like_known_image(
            b"\x00\x00\x00\x18ftyp" + brand
        ), brand


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
        _build_image_quality_inconclusive("nope")


def _build_image_quality_inconclusive(reason: str) -> ImageQualityInconclusive:
    return ImageQualityInconclusive(reason=reason)


# ---------------------------------------------------------------------------
# Decompression-bomb guard
# ---------------------------------------------------------------------------


def test_assess_image_quality_rejects_decompression_bomb(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pillow's DecompressionBombError must map to the image_too_large reason.

    We monkeypatch Image.open to raise the error rather than constructing a
    genuine bomb-sized image, which would be slow and might hit resource limits
    in CI. The payload prefix below is a valid PNG signature so it passes
    the magic-bytes pre-decode guard and actually reaches the monkey-patched
    ``Image.open`` — using arbitrary bytes here would short-circuit on the
    signature check and never exercise the decompression-bomb path.
    """
    from PIL import Image as _PILImage

    def _raise(*_a: object, **_kw: object) -> None:
        raise _PILImage.DecompressionBombError("Image size exceeds limit")

    monkeypatch.setattr(image_quality.Image, "open", _raise)

    payload = b"\x89PNG\r\n\x1a\n" + b"fake-bytes"
    with pytest.raises(ImageQualityInconclusive) as exc_info:
        image_quality.assess_image_quality(payload)
    assert exc_info.value.reason == "image_too_large"
    assert exc_info.value.code == "IMAGE_QUALITY_INCONCLUSIVE"
