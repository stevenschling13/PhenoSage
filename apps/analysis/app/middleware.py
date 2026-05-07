from __future__ import annotations

import json
import logging
import time
from contextvars import ContextVar
from uuid import uuid4

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

REQUEST_ID_HEADER = "x-request-id"
_request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


def get_request_id() -> str:
    return _request_id_ctx.get()


def log_event(level: int, message: str, **fields: object) -> None:
    payload = {
        "level": logging.getLevelName(level).lower(),
        "message": message,
        "request_id": get_request_id(),
        "service": "phenosage-analysis",
        **fields,
    }
    logging.getLogger("phenosage.analysis").log(level, json.dumps(payload, default=str))


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        request_id = request.headers.get(REQUEST_ID_HEADER, "").strip() or str(uuid4())
        token = _request_id_ctx.set(request_id)
        request.state.request_id = request_id
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
            _request_id_ctx.reset(token)
            raise

        response.headers[REQUEST_ID_HEADER] = request_id
        log_event(
            logging.INFO,
            "request completed",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=round((time.perf_counter() - start) * 1000, 2),
        )
        _request_id_ctx.reset(token)
        return response
