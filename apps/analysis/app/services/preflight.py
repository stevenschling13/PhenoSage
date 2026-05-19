"""Non-destructive capture-quality preflight.

Called by the web app between upload finalisation and the analyse call so
the user can be told *before* a vision-model request is paid for that
their image is too dark / blurry / wrong-format / etc.

Implementation deliberately reuses :func:`assess_image_quality` so the
preflight and the pre-analysis gate share one source of truth on
thresholds — tuning one tunes both.

Failure modes:

* Storage misconfigured / 401 from Supabase → ``ConfigurationError`` (the
  router maps it to a 500 with a redaction-safe message).
* Storage transient outage → ``StorageUnavailable``; retried up to three
  times by :func:`with_retry`. Final exhaustion bubbles to the router.

Programmer defects (TypeError etc.) propagate as 500s — never silently
re-skinned as a "looks fine" preflight result, per Rule 9 of
``.github/copilot-instructions.md``.
"""

from __future__ import annotations

import logging

from app.middleware import get_request_id, log_event
from app.models.analysis import PreflightRequest, PreflightResponse
from app.services.image_quality import preflight_image_quality
from app.services.retry import with_retry
from app.services.storage import fetch_image

logger = logging.getLogger(__name__)

_STORAGE_FETCH_MAX_ATTEMPTS = 3


async def run_preflight(request: PreflightRequest) -> PreflightResponse:
    """Fetch the image referenced by ``request`` and run the quality gate.

    Returns a :class:`PreflightResponse` whose ``ok`` is True iff the image
    would be accepted by :func:`assess_image_quality`. When False, ``reason``
    and ``hint`` describe the failure in user-actionable terms.
    """
    image_bytes, _content_type = await with_retry(
        lambda: fetch_image(request.storage_path),
        operation="storage.fetch.preflight",
        max_attempts=_STORAGE_FETCH_MAX_ATTEMPTS,
    )

    result = preflight_image_quality(image_bytes)

    log_event(
        logging.INFO,
        "preflight completed",
        plant_id=request.plant_id,
        image_id=request.image_id,
        ok=result.ok,
        # Only set when ok=False; keep low-cardinality for log indexing.
        reason=result.reason,
    )

    return PreflightResponse(
        plant_id=request.plant_id,
        image_id=request.image_id,
        ok=result.ok,
        reason=result.reason,
        hint=result.hint,
        request_id=get_request_id(),
    )
