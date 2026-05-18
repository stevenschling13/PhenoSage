"""Pre-vision image-quality gate.

Goal: refuse images that the vision model can't reliably interpret, so the
user-facing result becomes an explicit *inconclusive* state rather than a
low-confidence diagnosis. See `.github/copilot-instructions.md` §9.

Heuristics — all computed with Pillow alone (no numpy / cv2):

* **Magic bytes** — before any decode, confirm the first few bytes match a
  known image format signature (JPEG, PNG, WebP, HEIC). Defence in depth
  against clients that mislabel a non-image payload as an image; reason
  ``image_decode_failed`` (same as Pillow's own UnidentifiedImageError,
  since both mean "this isn't a usable image"). Pillow itself rejects
  unknown formats, but checking signatures first means a crafted /
  truncated file never reaches Pillow's decoders — and Pillow has had
  parser CVEs in the past, so cutting it off at the boundary is cheap
  insurance.
* **Decode** — if Pillow can't open / verify the bytes, reason
  ``image_decode_failed``.
* **Minimum size** — anything below :data:`MIN_DIMENSION_PX` on either side
  is too small to contain a useful plant detail; reason ``image_too_small``.
* **Luminance** (mean of the grayscale channel):

  * ``< MIN_LUMINANCE`` → ``too_dark`` (under-exposed / lens-cap shot).
  * ``> MAX_LUMINANCE`` → ``too_bright`` (blown-out highlights).

* **Edge variance** — variance of an edge-detected grayscale image with the
  1-pixel border cropped off. PIL's :data:`ImageFilter.FIND_EDGES` produces
  artificial edges at the image border via convolution wrap-around, so we
  drop that ring before measuring. Below :data:`MIN_EDGE_VARIANCE` the
  image carries almost no spatial information (out-of-focus, motion-blur,
  uniform colour); reason ``too_blurry``.

Check ordering matters: magic bytes is first (cheapest, most defensive),
luminance is checked before blur because a black or white-out image is
*also* technically blurry, but ``too_dark`` / ``too_bright`` is the more
actionable user-facing reason. Thresholds are module-level constants —
easy to tune from a single place if real-world data shows we're rejecting
good photos.
"""

from __future__ import annotations

import io

from PIL import Image, ImageFilter, ImageStat, UnidentifiedImageError

from app.errors import ImageQualityInconclusive

# Tuned against the calibration matrix in `tests/test_image_quality.py`.
# Rationale lives in the module docstring; bump these via a follow-up perf
# pass once we have field data, not here in code review.
MIN_DIMENSION_PX = 64
MIN_LUMINANCE = 15.0
MAX_LUMINANCE = 235.0
MIN_EDGE_VARIANCE = 50.0


def _looks_like_known_image(image_bytes: bytes) -> bool:
    """Return True iff ``image_bytes`` starts with a signature for one of
    the formats the upload route accepts (JPEG, PNG, WebP, HEIC).

    Implementation notes:
      * JPEG starts with ``FF D8 FF`` — that 3-byte SOI marker is the
        only stable prefix across the dozen-plus JPEG variants.
      * PNG has an 8-byte fixed signature.
      * WebP is a RIFF container — bytes 0..3 are ``RIFF``, then a
        4-byte little-endian length, then bytes 8..11 are ``WEBP``.
      * HEIC / HEIF stores the brand inside an ``ftyp`` box at offset
        4. We accept the common HEIC brands (``heic``, ``heix``,
        ``hevc``, ``hevx``) plus the generic HEIF brands (``mif1``,
        ``msf1``) that Apple cameras sometimes emit.

    Anything else — PDFs, ZIPs, executables, plain text mislabelled as
    ``image/png`` — gets rejected before it reaches Pillow.
    """
    if len(image_bytes) < 12:
        return False
    if image_bytes[:3] == b"\xff\xd8\xff":  # JPEG SOI
        return True
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":  # PNG
        return True
    if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return True
    # HEIC / HEIF: `ftyp` box marker followed by a 4-byte brand at
    # offset 8. We don't bother validating the box length field — a
    # malformed length would still trip Pillow's decoder downstream.
    if image_bytes[4:8] == b"ftyp" and image_bytes[8:12] in {
        b"heic",
        b"heix",
        b"hevc",
        b"hevx",
        b"mif1",
        b"msf1",
    }:
        return True
    return False


def assess_image_quality(image_bytes: bytes) -> None:
    """Raise :class:`ImageQualityInconclusive` if the image is unanalysable.

    Pure CPU work; no I/O. Intentionally *returns* nothing — successful
    completion means the caller may proceed to the vision model.
    """
    # Magic-bytes check first. Pillow itself rejects unknown formats
    # via UnidentifiedImageError, but we'd rather not feed bytes of
    # unknown shape to a C-extension parser at all — Pillow / libjpeg
    # / libwebp have all shipped parser CVEs in the past. This pre-
    # check is a cheap "is the prefix plausibly an image?" gate.
    if not _looks_like_known_image(image_bytes):
        raise ImageQualityInconclusive(reason="image_decode_failed")

    try:
        with Image.open(io.BytesIO(image_bytes)) as opened:
            # `Image.open` is lazy; force a decode so corrupt payloads fail
            # here, not deep in the analysis pipeline.
            opened.load()
            grayscale = opened.convert("L")
    except Image.DecompressionBombError as exc:
        # Pillow raises DecompressionBombError for images that exceed
        # MAX_IMAGE_PIXELS (default ~178 MP) to guard against zip-bomb
        # style attacks. Map to a stable reason rather than letting it
        # bubble as an untyped 500.
        raise ImageQualityInconclusive(reason="image_too_large") from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageQualityInconclusive(reason="image_decode_failed") from exc

    width, height = grayscale.size
    if width < MIN_DIMENSION_PX or height < MIN_DIMENSION_PX:
        raise ImageQualityInconclusive(reason="image_too_small")

    luminance = ImageStat.Stat(grayscale).mean[0]
    if luminance < MIN_LUMINANCE:
        raise ImageQualityInconclusive(reason="too_dark")
    if luminance > MAX_LUMINANCE:
        raise ImageQualityInconclusive(reason="too_bright")

    edges = grayscale.filter(ImageFilter.FIND_EDGES)
    # Crop the 1-px border to drop FIND_EDGES convolution artefacts that
    # would otherwise make uniform images look edge-rich.
    edge_w, edge_h = edges.size
    if edge_w > 2 and edge_h > 2:
        edges = edges.crop((1, 1, edge_w - 1, edge_h - 1))
    edge_variance = ImageStat.Stat(edges).var[0]
    if edge_variance < MIN_EDGE_VARIANCE:
        raise ImageQualityInconclusive(reason="too_blurry")


__all__ = [
    "MAX_LUMINANCE",
    "MIN_DIMENSION_PX",
    "MIN_EDGE_VARIANCE",
    "MIN_LUMINANCE",
    "assess_image_quality",
]
