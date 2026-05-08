"""
Tests for the OpenAI retry policy in image_analysis.

The retry decorator is owned by tenacity (so each retry can be logged
with a request id, which the OpenAI SDK's own retry loop hides).
These tests verify that:
  - Retryable errors (APIConnectionError, APITimeoutError, 5xx, 429)
    cause additional attempts up to settings.openai_max_retries + 1.
  - Non-retryable errors (e.g. BadRequestError 400) fail fast.
  - When retries are exhausted, the catch-all in run_analysis returns
    the inconclusive fallback response — never a confident result.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest
from openai import APIConnectionError, APIStatusError, BadRequestError
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_none,
)

from app.config import settings
from app.middleware import _request_id_ctx
from app.models.analysis import AnalyzeRequest, GrowContext
from app.services import image_analysis
from app.services.image_analysis import (
    _is_retryable_openai_error,
    _log_retry,
    run_analysis,
)

# ── Predicate ────────────────────────────────────────────────────────────


def test_is_retryable_openai_error_for_transport_failures() -> None:
    assert _is_retryable_openai_error(
        APIConnectionError(request=httpx.Request("POST", "https://x"))
    )


def test_is_retryable_openai_error_for_5xx_and_429() -> None:
    fake_request = httpx.Request("POST", "https://x")
    fake_500 = httpx.Response(500, request=fake_request)
    fake_429 = httpx.Response(429, request=fake_request)
    assert _is_retryable_openai_error(
        APIStatusError("server boom", response=fake_500, body=None)
    )
    assert _is_retryable_openai_error(
        APIStatusError("rate limited", response=fake_429, body=None)
    )


def test_is_retryable_openai_error_skips_4xx_other() -> None:
    fake_request = httpx.Request("POST", "https://x")
    fake_400 = httpx.Response(400, request=fake_request)
    assert not _is_retryable_openai_error(
        BadRequestError("bad", response=fake_400, body=None)
    )


def test_is_retryable_openai_error_skips_unknown_exceptions() -> None:
    assert not _is_retryable_openai_error(ValueError("unrelated"))


# ── End-to-end via run_analysis ──────────────────────────────────────────


@pytest.fixture(autouse=True)
def _seed_request_id():
    token = _request_id_ctx.set("rid-test")
    yield
    _request_id_ctx.reset(token)


@pytest.fixture
def _fast_retrying(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace `_make_retrying` so tests never sleep between retries."""

    def _factory() -> AsyncRetrying:
        return AsyncRetrying(
            stop=stop_after_attempt(settings.openai_max_retries + 1),
            wait=wait_none(),
            retry=retry_if_exception(_is_retryable_openai_error),
            before_sleep=_log_retry,
            reraise=True,
        )

    monkeypatch.setattr(image_analysis, "_make_retrying", _factory)


def _request() -> AnalyzeRequest:
    return AnalyzeRequest(
        plant_id="p1",
        image_id="img-1",
        storage_path="plants/p1/img.jpg",
        grow_context=GrowContext(grow_id="g1"),
    )


def _ok_completion() -> Any:
    msg = MagicMock()
    msg.content = (
        '{"overall_health_score": 88,'
        ' "summary": "Healthy.",'
        ' "findings": [{'
        '"category": "positive",'
        '"severity": "info",'
        '"title": "Looking good",'
        '"description": "No issues identified.",'
        '"recommendation": "Continue current practices."'
        "}]}"
    )
    choice = MagicMock()
    choice.message = msg
    completion = MagicMock()
    completion.choices = [choice]
    return completion


def _client_with_create(create_fn: Any) -> Any:
    client = MagicMock()
    client.chat.completions.create = create_fn
    return client


async def _fetch_small(_path: str) -> tuple[bytes, str]:
    return b"x" * 16, "image/jpeg"


@pytest.mark.asyncio
async def test_run_analysis_retries_then_succeeds(
    monkeypatch: pytest.MonkeyPatch, _fast_retrying: None
) -> None:
    monkeypatch.setattr(settings, "openai_max_retries", 2)
    monkeypatch.setattr(image_analysis, "fetch_storage_image", _fetch_small)

    call_count = {"n": 0}

    async def flaky_create(**_kwargs: Any) -> Any:
        call_count["n"] += 1
        if call_count["n"] < 3:
            raise APIConnectionError(request=httpx.Request("POST", "https://x"))
        return _ok_completion()

    monkeypatch.setattr(
        image_analysis,
        "get_openai_client",
        lambda: _client_with_create(flaky_create),
    )

    response = await run_analysis(_request())

    assert call_count["n"] == 3
    assert response.analysis_mode == "model"
    assert response.is_fallback is False


@pytest.mark.asyncio
async def test_run_analysis_falls_back_when_retries_exhausted(
    monkeypatch: pytest.MonkeyPatch, _fast_retrying: None
) -> None:
    monkeypatch.setattr(settings, "openai_max_retries", 1)
    monkeypatch.setattr(image_analysis, "fetch_storage_image", _fetch_small)

    call_count = {"n": 0}

    async def always_503(**_kwargs: Any) -> Any:
        call_count["n"] += 1
        fake_response = httpx.Response(
            503, request=httpx.Request("POST", "https://x")
        )
        raise APIStatusError("service unavailable", response=fake_response, body=None)

    monkeypatch.setattr(
        image_analysis,
        "get_openai_client",
        lambda: _client_with_create(always_503),
    )

    response = await run_analysis(_request())

    # 1 initial + 1 retry = 2 attempts.
    assert call_count["n"] == 2
    assert response.analysis_mode == "fallback"
    assert response.is_fallback is True
    assert response.fallback_reason == "APIStatusError"


@pytest.mark.asyncio
async def test_run_analysis_does_not_retry_non_retryable_errors(
    monkeypatch: pytest.MonkeyPatch, _fast_retrying: None
) -> None:
    monkeypatch.setattr(settings, "openai_max_retries", 5)
    monkeypatch.setattr(image_analysis, "fetch_storage_image", _fetch_small)

    call_count = {"n": 0}

    async def bad_request(**_kwargs: Any) -> Any:
        call_count["n"] += 1
        fake_response = httpx.Response(
            400, request=httpx.Request("POST", "https://x")
        )
        raise BadRequestError("bad", response=fake_response, body=None)

    monkeypatch.setattr(
        image_analysis,
        "get_openai_client",
        lambda: _client_with_create(bad_request),
    )

    response = await run_analysis(_request())

    # 4xx is non-retryable; exactly one attempt.
    assert call_count["n"] == 1
    assert response.is_fallback is True
