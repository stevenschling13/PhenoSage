"""Request-scoped correlation IDs + structured access logging."""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("phenosage.access")
REQUEST_ID_HEADER = "x-request-id"


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Ensures every request has an ``x-request-id`` header on the response.

    Honors an inbound ``x-request-id`` so the Next.js proxy can stitch traces
    across service boundaries. Attaches the ID to ``request.state`` for handlers
    that want to include it in structured logs.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        inbound = request.headers.get(REQUEST_ID_HEADER)
        correlation_id = (
            inbound
            if inbound and 1 <= len(inbound) <= 128
            else uuid.uuid4().hex
        )
        request.state.correlation_id = correlation_id

        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            _access_log(request, None, elapsed_ms, correlation_id, error=True)
            raise

        response.headers[REQUEST_ID_HEADER] = correlation_id
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        _access_log(request, response.status_code, elapsed_ms, correlation_id)
        return response


def _access_log(
    request: Request,
    status: int | None,
    elapsed_ms: float,
    correlation_id: str,
    *,
    error: bool = False,
) -> None:
    record = {
        "level": "error" if error else "info",
        "msg": "http_request",
        "method": request.method,
        "path": request.url.path,
        "status": status,
        "elapsed_ms": round(elapsed_ms, 2),
        "request_id": correlation_id,
    }
    logger.info(json.dumps(record))
