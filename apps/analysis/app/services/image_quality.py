"""Pre-vision image-quality gate.

Goal: refuse images that the vision model can't reliably interpret, so the
user-facing result becomes an explicit *inconclusive* state rather than a
low-confidence diagnosis. See `.github/copilot-instructions.md` §9.

Heuristics — all computed with Pillow alone (no numpy / cv2):

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

Check ordering matters: luminance is checked before blur because a black or
white-out image is *also* technically blurry, but ``too_dark`` /
``too_bright`` is the more actionable user-facing reason. Thresholds are
module-level constants — easy to tune from a single place if real-world
data shows we're rejecting good photos.
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


def assess_image_quality(image_bytes: bytes) -> None:
    """Raise :class:`ImageQualityInconclusive` if the image is unanalysable.

    Pure CPU work; no I/O. Intentionally *returns* nothing — successful
    completion means the caller may proceed to the vision model.
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as opened:
            # `Image.open` is lazy; force a decode so corrupt payloads fail
            # here, not deep in the analysis pipeline.
            opened.load()
            grayscale = opened.convert("L")
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
