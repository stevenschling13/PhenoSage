from __future__ import annotations

import json
import logging
import re
import secrets
import time
from contextvars import ContextVar
from uuid import uuid4

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

REQUEST_ID_HEADER = "x-request-id"
TRACEPARENT_HEADER = "traceparent"

# Anchored W3C Trace Context regex. Mirrors apps/web/src/lib/server/trace-context.ts
# so the two services agree on which inbound values are trustworthy.
# Spec: https://www.w3.org/TR/trace-context/
_TRACEPARENT_PATTERN = re.compile(
    r"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$"
)
_ALL_ZERO_TRACE = re.compile(r"^0+$")

_request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")
# Trace-context fields are stored alongside the request id so log_event
# can attach them automatically to every line emitted during this
# request without each call-site having to thread them through.
_trace_id_ctx: ContextVar[str] = ContextVar("trace_id", default="-")
_span_id_ctx: ContextVar[str] = ContextVar("span_id", default="-")
_parent_span_id_ctx: ContextVar[str] = ContextVar("parent_span_id", default="-")


def get_request_id() -> str:
    return _request_id_ctx.get()


def get_trace_id() -> str:
    return _trace_id_ctx.get()


def get_span_id() -> str:
    return _span_id_ctx.get()


def _random_hex(byte_count: int) -> str:
    return secrets.token_hex(byte_count)


def _parse_traceparent(value: str | None) -> tuple[str, str, str] | None:
    """Return ``(trace_id, parent_span_id, flags)`` when ``value`` is a
    well-formed W3C ``traceparent``.  Reject the all-zero degenerate
    forms which the spec forbids — they're a common shape from
    misconfigured emitters and would otherwise pollute our trace ids.
    """
    if not value:
        return None
    match = _TRACEPARENT_PATTERN.match(value.strip())
    if not match:
        return None
    trace_id, parent_span_id, flags = match.groups()
    if _ALL_ZERO_TRACE.match(trace_id) or _ALL_ZERO_TRACE.match(parent_span_id):
        return None
    return trace_id, parent_span_id, flags


def _build_trace_context(inbound: str | None) -> tuple[str, str, str | None, str]:
    """Return ``(trace_id, span_id, parent_span_id, flags)``.

    Continues an inbound trace when one was supplied, otherwise mints
    a fresh one and marks this hop as the trace originator
    (``parent_span_id is None``).
    """
    parsed = _parse_traceparent(inbound)
    if parsed is not None:
        trace_id, parent_span_id, flags = parsed
        return trace_id, _random_hex(8), parent_span_id, flags
    return _random_hex(16), _random_hex(8), None, "00"


def log_event(level: int, message: str, **fields: object) -> None:
    """Emit a structured JSON log line with request + trace fields.

    ``trace_id`` / ``span_id`` are always populated. ``parent_span_id``
    is omitted on trace-originator hops so on-call doesn't waste time
    grepping for ``"-"`` as a parent id.
    """
    payload: dict[str, object] = {
        "level": logging.getLevelName(level).lower(),
        "message": message,
        "request_id": get_request_id(),
        "trace_id": get_trace_id(),
        "span_id": get_span_id(),
        "service": "phenosage-analysis",
        **fields,
    }
    parent = _parent_span_id_ctx.get()
    if parent != "-":
        payload["parent_span_id"] = parent
    logging.getLogger("phenosage.analysis").log(level, json.dumps(payload, default=str))


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Resolve request id + W3C trace context for every incoming request.

    The context variables set here are picked up by ``log_event``
    anywhere in the request lifecycle — there's no need to thread the
    trace fields through each call site explicitly.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        request_id = request.headers.get(REQUEST_ID_HEADER, "").strip() or str(uuid4())
        inbound_traceparent = request.headers.get(TRACEPARENT_HEADER)
        trace_id, span_id, parent_span_id, flags = _build_trace_context(
            inbound_traceparent
        )

        rid_token = _request_id_ctx.set(request_id)
        trace_token = _trace_id_ctx.set(trace_id)
        span_token = _span_id_ctx.set(span_id)
        parent_token = _parent_span_id_ctx.set(parent_span_id or "-")

        request.state.request_id = request_id
        request.state.trace_id = trace_id
        request.state.span_id = span_id
        # `outbound_traceparent` is the wire value any code inside the
        # request handler should send on its own outbound calls (the
        # value identifies THIS span as the parent on the next hop).
        request.state.outbound_traceparent = f"00-{trace_id}-{span_id}-{flags}"

        start = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            log_event(
                logging.ERROR,
                "request failed",
                method=request.method,
                path=request.url.path,
                duration_ms=round((time.perf_counter() - start) * 1000, 2),
            )
            _request_id_ctx.reset(rid_token)
            _trace_id_ctx.reset(trace_token)
            _span_id_ctx.reset(span_token)
            _parent_span_id_ctx.reset(parent_token)
            raise

        response.headers[REQUEST_ID_HEADER] = request_id
        # Echo the inbound trace fields back on the response so the
        # caller (apps/web) can correlate the response with its own
        # span without having to keep the request-side state.
        response.headers[TRACEPARENT_HEADER] = request.state.outbound_traceparent

        log_event(
            logging.INFO,
            "request completed",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=round((time.perf_counter() - start) * 1000, 2),
        )
        _request_id_ctx.reset(rid_token)
        _trace_id_ctx.reset(trace_token)
        _span_id_ctx.reset(span_token)
        _parent_span_id_ctx.reset(parent_token)
        return response
