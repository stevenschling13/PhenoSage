"""Async retry helper with bounded attempts and full-jitter exponential backoff.

Mirrors the policy used by ``apps/web/src/lib/server/resilience.ts`` so the
two services behave consistently when an upstream is transiently degraded:

  * Only ``AnalysisError`` subclasses with ``retryable=True`` are retried.
    Configuration errors, programmer defects (``TypeError`` etc.), and
    non-retryable analysis errors propagate immediately — never silently
    swallowed into a fake fallback diagnosis.
  * Backoff uses full jitter: ``delay = random(0, min(max_delay, base * 2^n))``.
  * The first attempt runs immediately; sleeps occur **between** attempts.
  * Sleep is injectable so tests do not pay real wall-clock time.

No third-party dependency: ``tenacity`` would work but is overkill for the
single call site we have here, and adding a dep to the analysis service
should be a deliberate decision documented in the PR.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from collections.abc import Awaitable, Callable
from typing import TypeVar

from app.errors import AnalysisError
from app.middleware import get_request_id, log_event

T = TypeVar("T")

# Module-level so tests can monkeypatch a no-op without monkeypatching
# ``asyncio.sleep`` globally.
_DEFAULT_SLEEP: Callable[[float], Awaitable[None]] = asyncio.sleep


def _full_jitter_delay(
    attempt: int,
    *,
    base_delay_s: float,
    max_delay_s: float,
) -> float:
    """Compute the sleep between ``attempt`` (just failed) and the next one.

    ``attempt`` is 1-indexed. ``secrets.randbelow`` is used instead of
    ``random.random`` to satisfy the repo's "no ``Math.random``-style
    non-cryptographic RNG in production code" guardrail consistently across
    both the TS and Python services.
    """
    exp = base_delay_s * (2 ** (attempt - 1))
    ceiling = min(max_delay_s, exp)
    if ceiling <= 0:
        return 0.0
    # randbelow(n) returns [0, n). Scale by ceiling / n to get a float in
    # [0, ceiling). A million buckets is plenty of resolution for jitter.
    return float(ceiling * (secrets.randbelow(1_000_000) / 1_000_000))


async def with_retry(  # noqa: UP047 - PEP 695 generics require Python 3.12; local dev is 3.11
    fn: Callable[[], Awaitable[T]],
    *,
    operation: str,
    max_attempts: int = 3,
    base_delay_s: float = 0.1,
    max_delay_s: float = 2.0,
    sleep: Callable[[float], Awaitable[None]] | None = None,
) -> T:
    """Run ``fn`` with bounded retries on retryable ``AnalysisError``s.

    ``fn`` is a zero-argument async callable so callers can close over the
    exact arguments they need without this helper having to be generic over
    them. On success returns ``fn``'s value. On exhaustion re-raises the
    final ``AnalysisError``. On non-retryable errors raises immediately.

    Parameters
    ----------
    operation:
        Stable, low-cardinality label used in retry / failure logs (e.g.
        ``"storage.fetch"``, ``"model.analyze"``).
    max_attempts:
        Total attempts including the first. Must be >= 1. ``1`` disables
        retries; the helper still classifies / logs the error.
    base_delay_s, max_delay_s:
        Bounds for the jittered backoff between attempts.
    sleep:
        Override the async sleep function (test seam). Defaults to
        ``asyncio.sleep``.
    """
    if max_attempts < 1:
        raise ValueError(f"max_attempts must be >= 1 (operation={operation!r})")

    sleep_fn = sleep if sleep is not None else _DEFAULT_SLEEP
    last_error: AnalysisError | None = None

    for attempt in range(1, max_attempts + 1):
        try:
            return await fn()
        except AnalysisError as exc:
            if not exc.retryable or attempt == max_attempts:
                log_event(
                    logging.WARNING if exc.retryable else logging.ERROR,
                    "upstream call failed",
                    operation=operation,
                    attempt=attempt,
                    max_attempts=max_attempts,
                    upstream_code=exc.code,
                    retryable=exc.retryable,
                    request_id=get_request_id(),
                )
                raise
            last_error = exc
            delay = _full_jitter_delay(
                attempt,
                base_delay_s=base_delay_s,
                max_delay_s=max_delay_s,
            )
            log_event(
                logging.WARNING,
                "upstream call retrying",
                operation=operation,
                attempt=attempt,
                max_attempts=max_attempts,
                upstream_code=exc.code,
                backoff_ms=int(delay * 1000),
                request_id=get_request_id(),
            )
            await sleep_fn(delay)
        # Non-AnalysisError exceptions intentionally propagate — see
        # ``run_analysis``'s docstring re: programmer-defect discipline.

    # Defensive: the loop must always return or raise. ``last_error`` is
    # populated whenever we reach this point because every iteration either
    # returns, raises, or assigns ``last_error`` before sleeping.
    assert last_error is not None  # pragma: no cover - defensive
    raise last_error


__all__ = ["with_retry"]
