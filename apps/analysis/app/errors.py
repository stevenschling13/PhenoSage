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
    "AnalysisError",
    "ConfigurationError",
    "ModelBadResponse",
    "ModelRateLimited",
    "ModelUnavailable",
    "StorageUnavailable",
]
