"""Typed exception hierarchy for the analysis service.

Promotes "expected dependency failures" into first-class data so:
  - Route handlers can return a stable JSON envelope (no raw exception text).
  - Fallback logic can distinguish "model temporarily unavailable" (retry-safe)
    from "programmer defect" (must surface, not be swallowed as a fallback
    diagnosis — the user-facing diagnosis discipline forbids hiding bugs
    behind an inconclusive result).
  - The web proxy can map `code` → `ApiErrorCode` cleanly.

`code` values are stable, low-cardinality, and safe to log / surface in
the API envelope. `retryable` mirrors the AWS Well-Architected reliability
guidance: only timeouts / 5xx / rate-limits / transport errors should be
retried, never auth / config errors.
"""

from __future__ import annotations


class AnalysisError(Exception):
    """Base for every typed analysis failure. Never instantiate directly."""

    code: str = "ANALYSIS_ERROR"
    status_code: int = 500
    retryable: bool = False
    # Human-readable, redaction-safe message. Never include raw provider
    # bodies, signed URLs, or env-var names.
    default_message: str = "Analysis failed."

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.default_message)


class StorageUnavailable(AnalysisError):
    code = "STORAGE_UNAVAILABLE"
    status_code = 503
    retryable = True
    default_message = "Image storage is temporarily unavailable."


class ModelUnavailable(AnalysisError):
    code = "MODEL_UNAVAILABLE"
    status_code = 503
    retryable = True
    default_message = "The analysis model is temporarily unavailable."


class ModelRateLimited(AnalysisError):
    code = "MODEL_RATE_LIMITED"
    status_code = 429
    retryable = True
    default_message = "The analysis model is rate-limited; please retry."


class ModelBadResponse(AnalysisError):
    """The model returned a response we couldn't safely parse / trust."""

    code = "MODEL_BAD_RESPONSE"
    status_code = 502
    retryable = False
    default_message = "The analysis model returned an unexpected response."


class InvalidStoragePath(AnalysisError):
    """The supplied storage path failed defence-in-depth sanitisation.

    The Pydantic validator on AnalyzeRequest is the primary guard; this is
    raised by the storage fetcher's own check so an internal caller that
    bypasses the API model still cannot smuggle a crafted URL through.
    """

    code = "INVALID_STORAGE_PATH"
    status_code = 400
    retryable = False
    default_message = "Invalid storage path."


ImageQualityReason = str
"""One of the values in :data:`IMAGE_QUALITY_REASONS`.

Kept as a plain ``str`` alias (rather than a ``Literal``) so the runtime
validator in :class:`ImageQualityInconclusive` is the single source of truth.
The web proxy logs this value verbatim — extending the tuple is additive,
renaming an existing entry is a breaking change.
"""

IMAGE_QUALITY_REASONS: tuple[str, ...] = (
    "image_decode_failed",
    "image_too_small",
    "too_dark",
    "too_bright",
    "too_blurry",
)


class ImageQualityInconclusive(AnalysisError):
    """The supplied image is unfit for vision analysis.

    Raised by the pre-vision quality gate (`app.services.image_quality`) so
    the user-facing result becomes an explicit *inconclusive* envelope —
    never a low-confidence diagnosis. See `.github/copilot-instructions.md`
    §9 (Plant-Health Output Discipline).

    The ``reason`` is one of :data:`IMAGE_QUALITY_REASONS` and is forwarded
    to the structured log; the default message stays generic so we never
    leak pixel-level metrics or storage paths.
    """

    code = "IMAGE_QUALITY_INCONCLUSIVE"
    status_code = 422
    retryable = False
    default_message = (
        "The image quality is too low for a confident analysis. "
        "Please retake the photo and try again."
    )

    def __init__(self, *, reason: ImageQualityReason, message: str | None = None) -> None:
        if reason not in IMAGE_QUALITY_REASONS:
            raise ValueError(f"Unknown image-quality reason: {reason!r}")
        self.reason = reason
        super().__init__(message)


class ConfigurationError(AnalysisError):
    """Required configuration (env, credentials) is missing or invalid.

    Treated as non-retryable because retrying without an operator change is
    pointless, and surfacing it loudly nudges Ops to fix the deployment.
    """

    code = "CONFIGURATION_ERROR"
    status_code = 500
    retryable = False
    default_message = "Analysis service is misconfigured."


__all__ = [
    "IMAGE_QUALITY_REASONS",
    "AnalysisError",
    "ConfigurationError",
    "ImageQualityInconclusive",
    "ImageQualityReason",
    "InvalidStoragePath",
    "ModelBadResponse",
    "ModelRateLimited",
    "ModelUnavailable",
    "StorageUnavailable",
]
