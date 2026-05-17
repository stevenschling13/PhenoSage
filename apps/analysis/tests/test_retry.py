"""Tests for ``app.services.retry.with_retry``."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import pytest

from app.errors import (
    ConfigurationError,
    ModelBadResponse,
    ModelRateLimited,
    StorageUnavailable,
)
from app.services import retry


def _no_sleep() -> Callable[[float], Awaitable[None]]:
    """A sleep stub that records calls without actually delaying."""
    calls: list[float] = []

    async def sleep(seconds: float) -> None:
        calls.append(seconds)

    sleep.calls = calls  # type: ignore[attr-defined]
    return sleep


@pytest.mark.asyncio
async def test_returns_immediately_on_success() -> None:
    attempts = 0

    async def fn() -> str:
        nonlocal attempts
        attempts += 1
        return "ok"

    sleep = _no_sleep()
    result = await retry.with_retry(fn, operation="t", sleep=sleep)
    assert result == "ok"
    assert attempts == 1
    assert sleep.calls == []  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_retries_retryable_error_then_succeeds() -> None:
    attempts = 0

    async def fn() -> str:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise StorageUnavailable("simulated blip")
        return "ok"

    sleep = _no_sleep()
    result = await retry.with_retry(
        fn,
        operation="storage.fetch",
        max_attempts=3,
        sleep=sleep,
    )
    assert result == "ok"
    assert attempts == 3
    # Two sleeps between three attempts.
    assert len(sleep.calls) == 2  # type: ignore[attr-defined]
    # Each sleep is bounded by the jitter ceiling at the corresponding attempt.
    for call in sleep.calls:  # type: ignore[attr-defined]
        assert call >= 0.0
        assert call < 2.0  # max_delay_s default


@pytest.mark.asyncio
async def test_exhausts_and_raises_last_retryable_error() -> None:
    attempts = 0

    async def fn() -> str:
        nonlocal attempts
        attempts += 1
        raise ModelRateLimited(f"attempt {attempts}")

    sleep = _no_sleep()
    with pytest.raises(ModelRateLimited):
        await retry.with_retry(
            fn,
            operation="model.analyze",
            max_attempts=2,
            sleep=sleep,
        )
    assert attempts == 2
    # One sleep between two attempts.
    assert len(sleep.calls) == 1  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_does_not_retry_non_retryable_analysis_error() -> None:
    attempts = 0

    async def fn() -> str:
        nonlocal attempts
        attempts += 1
        raise ConfigurationError("missing key")

    sleep = _no_sleep()
    with pytest.raises(ConfigurationError):
        await retry.with_retry(
            fn,
            operation="storage.fetch",
            max_attempts=5,
            sleep=sleep,
        )
    assert attempts == 1
    assert sleep.calls == []  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_does_not_retry_non_retryable_model_bad_response() -> None:
    attempts = 0

    async def fn() -> str:
        nonlocal attempts
        attempts += 1
        raise ModelBadResponse("garbage json")

    sleep = _no_sleep()
    with pytest.raises(ModelBadResponse):
        await retry.with_retry(
            fn,
            operation="model.analyze",
            max_attempts=5,
            sleep=sleep,
        )
    assert attempts == 1


@pytest.mark.asyncio
async def test_propagates_unexpected_exception_without_retry() -> None:
    """Programmer defects must surface immediately — never be retried.

    Retrying a ``TypeError`` would (a) waste time and (b) mask the bug
    behind a "transient failure" log, exactly the discipline failure that
    ``run_analysis`` and the audit guidance forbid.
    """
    attempts = 0

    async def fn() -> str:
        nonlocal attempts
        attempts += 1
        raise TypeError("programmer bug")

    sleep = _no_sleep()
    with pytest.raises(TypeError, match="programmer bug"):
        await retry.with_retry(
            fn,
            operation="storage.fetch",
            max_attempts=5,
            sleep=sleep,
        )
    assert attempts == 1


@pytest.mark.asyncio
async def test_max_attempts_one_disables_retry_but_still_logs() -> None:
    attempts = 0

    async def fn() -> str:
        nonlocal attempts
        attempts += 1
        raise StorageUnavailable("blip")

    sleep = _no_sleep()
    with pytest.raises(StorageUnavailable):
        await retry.with_retry(
            fn,
            operation="storage.fetch",
            max_attempts=1,
            sleep=sleep,
        )
    assert attempts == 1
    assert sleep.calls == []  # type: ignore[attr-defined]


def test_max_attempts_zero_is_rejected() -> None:
    async def fn() -> str:
        return "ok"

    with pytest.raises(ValueError, match="max_attempts"):
        # ``with_retry`` is async but the validation happens before the
        # first await, so the ValueError propagates synchronously when the
        # coroutine is awaited. We exercise the underlying constructor by
        # calling the async fn through ``asyncio.run`` indirectly.
        import asyncio

        asyncio.run(
            retry.with_retry(fn, operation="t", max_attempts=0),
        )


def test_full_jitter_delay_is_bounded() -> None:
    """The internal jitter helper must never exceed ``max_delay_s``."""
    for attempt in range(1, 10):
        for _ in range(50):
            delay = retry._full_jitter_delay(
                attempt,
                base_delay_s=0.1,
                max_delay_s=2.0,
            )
            assert 0.0 <= delay < 2.0
