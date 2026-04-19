"""Request-scoped correlation IDs + structured access logging."""

from __future__ import annotations

import json
import logging
import time
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("phenosage.access")
REQUEST_ID_HEADER = "x-request-id"


class CorrelationIdMiddleware:
    """Ensures every request has an ``x-request-id`` header on the response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        inbound = headers.get(REQUEST_ID_HEADER)
        correlation_id = (
            inbound if inbound and 1 <= len(inbound) <= 128 else uuid.uuid4().hex
        )
        scope.setdefault("state", {})["correlation_id"] = correlation_id

        started = time.perf_counter()
        status_code: int | None = None

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                response_headers = MutableHeaders(scope=message)
                response_headers[REQUEST_ID_HEADER] = correlation_id
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            _access_log(scope, None, elapsed_ms, correlation_id, error=True)
            raise

        elapsed_ms = (time.perf_counter() - started) * 1000.0
        _access_log(scope, status_code, elapsed_ms, correlation_id)


def _access_log(
    scope: Scope,
    status: int | None,
    elapsed_ms: float,
    correlation_id: str,
    *,
    error: bool = False,
) -> None:
    record = {
        "level": "error" if error else "info",
        "msg": "http_request",
        "method": scope["method"],
        "path": scope["path"],
        "status": status,
        "elapsed_ms": round(elapsed_ms, 2),
        "request_id": correlation_id,
    }
    logger.info(json.dumps(record))
