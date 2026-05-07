"""Request-scoped correlation IDs + structured access logging (pure ASGI)."""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger("phenosage.access")
REQUEST_ID_HEADER = "x-request-id"
_HEADER_BYTES = REQUEST_ID_HEADER.encode("latin-1")

Scope = dict[str, Any]
Message = dict[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]


class CorrelationIdMiddleware:
    """Pure ASGI middleware — no ``BaseHTTPMiddleware`` overhead.

    Ensures every HTTP request has an ``x-request-id`` header on the response,
    honoring an inbound one when present so the Next.js proxy can stitch traces
    across service boundaries. Attaches the ID to ``scope["state"]`` so
    downstream handlers can include it in structured logs.
    """

    def __init__(self, app: ASGIApp, **_options: Any) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        correlation_id = _extract_or_mint(scope)
        state = scope.setdefault("state", {})
        state["correlation_id"] = correlation_id

        started = time.perf_counter()
        status_holder: dict[str, int] = {}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                headers = [h for h in headers if h[0].lower() != _HEADER_BYTES]
                headers.append((_HEADER_BYTES, correlation_id.encode("latin-1")))
                message["headers"] = headers
                status_holder["status"] = int(message.get("status", 0))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            _access_log(scope, None, elapsed_ms, correlation_id, error=True)
            raise

        elapsed_ms = (time.perf_counter() - started) * 1000.0
        _access_log(
            scope,
            status_holder.get("status"),
            elapsed_ms,
            correlation_id,
        )


def _extract_or_mint(scope: Scope) -> str:
    for name, value in scope.get("headers") or []:
        if name.lower() == _HEADER_BYTES:
            decoded: str = bytes(value).decode("latin-1", errors="replace")
            if 1 <= len(decoded) <= 128:
                return decoded
            break
    return uuid.uuid4().hex


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
        "method": scope.get("method"),
        "path": scope.get("path"),
        "status": status,
        "elapsed_ms": round(elapsed_ms, 2),
        "request_id": correlation_id,
    }
    logger.info(json.dumps(record))
