"""End-to-end tests for W3C `traceparent` propagation in
RequestContextMiddleware.

The middleware is the join point between apps/web and apps/analysis
in our trace pipeline: it must accept a well-formed inbound
traceparent and reject malformed values defensively (otherwise a
typo / crafted value pollutes our trace correlation), continue the
trace by minting a fresh span id, and echo the new traceparent back
on the response so callers can see what this hop spanned.
"""

from __future__ import annotations

import json
import re
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import middleware

SPAN_ID_RE = re.compile(r"^[0-9a-f]{16}$")
TRACE_ID_RE = re.compile(r"^[0-9a-f]{32}$")
TRACEPARENT_RE = re.compile(r"^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$")


@pytest.fixture
def app() -> FastAPI:
    """A minimal FastAPI app wired with the request-context middleware
    so the tests exercise the real production code path, not a
    re-implementation of the middleware's behaviour.
    """
    app = FastAPI()
    app.add_middleware(middleware.RequestContextMiddleware)

    @app.get("/ping")
    def ping() -> dict[str, object]:
        # Expose the middleware-resolved fields so tests can assert on
        # the in-handler view as well as the outbound headers.
        return {
            "request_id": middleware.get_request_id(),
            "trace_id": middleware.get_trace_id(),
            "span_id": middleware.get_span_id(),
        }

    return app


def _completion_log_payload(caplog: Any) -> dict[str, object] | None:
    """Find the `request completed` payload emitted by the middleware,
    parse the JSON, and return it. The middleware logs structured
    JSON so on-call can grep by `trace_id`; the test mirrors that
    parsing instead of asserting on free-form text.
    """
    for record in caplog.records:
        try:
            payload = json.loads(record.getMessage())
        except (json.JSONDecodeError, TypeError):
            continue
        if payload.get("message") == "request completed":
            return payload
    return None


def test_originates_a_fresh_trace_when_no_traceparent_inbound(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    client = TestClient(app)
    with caplog.at_level("INFO", logger="phenosage.analysis"):
        response = client.get("/ping")
    assert response.status_code == 200

    # In-handler view: trace fields are populated, not the "-" default.
    body = response.json()
    assert TRACE_ID_RE.match(body["trace_id"]), body["trace_id"]
    assert SPAN_ID_RE.match(body["span_id"]), body["span_id"]

    # Outbound header echoes the SAME trace/span the handler saw, so
    # the caller can correlate the response with its own next hop.
    outbound = response.headers["traceparent"]
    assert TRACEPARENT_RE.match(outbound), outbound
    assert body["trace_id"] in outbound
    assert body["span_id"] in outbound

    # Log line: no parent_span_id because this hop is the originator.
    log = _completion_log_payload(caplog)
    assert log is not None
    assert log["trace_id"] == body["trace_id"]
    assert log["span_id"] == body["span_id"]
    assert "parent_span_id" not in log


def test_continues_an_inbound_trace_and_emits_fresh_span(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    """The trace_id is the join key — it must survive verbatim across
    services. The span_id is per-hop, so it must change. The inbound
    span becomes our parent.
    """
    inbound_trace = "0af7651916cd43dd8448eb211c80319c"
    inbound_span = "b7ad6b7169203331"
    inbound_traceparent = f"00-{inbound_trace}-{inbound_span}-01"
    client = TestClient(app)
    with caplog.at_level("INFO", logger="phenosage.analysis"):
        response = client.get("/ping", headers={"traceparent": inbound_traceparent})
    assert response.status_code == 200

    body = response.json()
    assert body["trace_id"] == inbound_trace
    assert body["span_id"] != inbound_span
    assert SPAN_ID_RE.match(body["span_id"])

    # Outbound traceparent preserves trace + flags, swaps in new span.
    outbound = response.headers["traceparent"]
    assert outbound == f"00-{inbound_trace}-{body['span_id']}-01"

    log = _completion_log_payload(caplog)
    assert log is not None
    assert log["trace_id"] == inbound_trace
    assert log["parent_span_id"] == inbound_span
    assert log["span_id"] == body["span_id"]


@pytest.mark.parametrize(
    "bad_traceparent",
    [
        "not-a-real-traceparent",
        # Wrong version field
        "01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        # All-zero trace id (spec forbids; common emitter bug)
        "00-" + "0" * 32 + "-b7ad6b7169203331-01",
        # All-zero span id (same)
        "00-0af7651916cd43dd8448eb211c80319c-" + "0" * 16 + "-01",
        # Uppercase hex (spec forbids)
        "00-0AF7651916CD43DD8448EB211C80319C-b7ad6b7169203331-01",
        # Truncated
        "00-0af7-b7ad-01",
        # Empty
        "",
    ],
)
def test_rejects_malformed_traceparent_and_originates_a_fresh_trace(
    app: FastAPI, bad_traceparent: str
) -> None:
    """A malformed inbound value must NOT leak partial garbage into
    our trace_id. Better to start a fresh trace than to propagate
    corrupted state — once a bogus trace id is in our logs, it's the
    join key and ops can't grep around it.
    """
    client = TestClient(app)
    response = client.get("/ping", headers={"traceparent": bad_traceparent})
    assert response.status_code == 200

    body = response.json()
    # New trace; nothing of the bad input survives.
    assert TRACE_ID_RE.match(body["trace_id"]), body["trace_id"]
    if bad_traceparent and "0af7651916cd43dd8448eb211c80319c" in bad_traceparent:
        assert body["trace_id"] != "0af7651916cd43dd8448eb211c80319c"


def test_log_event_attaches_trace_fields_inside_request_scope(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    """Code that emits its own structured logs inside the request
    handler should pick up the trace context automatically via the
    contextvars, without each call site having to thread it through.
    """
    import logging

    @app.get("/log-once")
    def log_once() -> dict[str, str]:
        middleware.log_event(logging.INFO, "handler log line", custom_field="x")
        return {"trace_id": middleware.get_trace_id()}

    inbound_trace = "0af7651916cd43dd8448eb211c80319c"
    inbound_traceparent = f"00-{inbound_trace}-b7ad6b7169203331-01"
    client = TestClient(app)
    with caplog.at_level("INFO", logger="phenosage.analysis"):
        response = client.get("/log-once", headers={"traceparent": inbound_traceparent})
    assert response.status_code == 200

    # The handler-emitted log line should carry the same trace_id as
    # the middleware-emitted completion log — that's the entire point
    # of using contextvars.
    handler_payloads = []
    for record in caplog.records:
        try:
            payload = json.loads(record.getMessage())
        except (json.JSONDecodeError, TypeError):
            continue
        if payload.get("message") == "handler log line":
            handler_payloads.append(payload)
    assert handler_payloads
    assert handler_payloads[0]["trace_id"] == inbound_trace
    assert handler_payloads[0]["custom_field"] == "x"
