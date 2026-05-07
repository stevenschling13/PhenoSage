from __future__ import annotations

import logging
from collections.abc import Callable

import pytest

from app import telemetry


def test_init_sentry_noops_without_dsn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SENTRY_DSN", raising=False)

    telemetry.init_sentry()


def test_init_sentry_logs_when_optional_dependency_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger=telemetry.__name__)
    real_import = __import__

    def import_without_sentry(
        name: str,
        globals_: dict[str, object] | None = None,
        locals_: dict[str, object] | None = None,
        fromlist: tuple[str, ...] = (),
        level: int = 0,
    ) -> object:
        if name.startswith("sentry_sdk"):
            raise ImportError("sentry missing")
        return real_import(name, globals_, locals_, fromlist, level)

    monkeypatch.setenv("SENTRY_DSN", "https://example.invalid/1")
    monkeypatch.setattr("builtins.__import__", import_without_sentry)

    telemetry.init_sentry()

    assert "sentry-sdk not installed" in caplog.text


def test_init_otel_noops_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_ENABLED", "false")

    telemetry.init_otel()


def test_init_otel_logs_when_endpoint_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger=telemetry.__name__)
    monkeypatch.setenv("OTEL_ENABLED", "true")
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)

    telemetry.init_otel()

    assert "OTEL_EXPORTER_OTLP_ENDPOINT not set" in caplog.text


def test_init_otel_logs_when_optional_dependency_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger=telemetry.__name__)
    real_import = __import__

    def import_without_otel(
        name: str,
        globals_: dict[str, object] | None = None,
        locals_: dict[str, object] | None = None,
        fromlist: tuple[str, ...] = (),
        level: int = 0,
    ) -> object:
        if name.startswith("opentelemetry"):
            raise ImportError("otel missing")
        return real_import(name, globals_, locals_, fromlist, level)

    monkeypatch.setenv("OTEL_ENABLED", "true")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://otel.example.com")
    monkeypatch.setattr("builtins.__import__", import_without_otel)

    telemetry.init_otel()

    assert "opentelemetry-sdk not installed" in caplog.text


def test_init_all_calls_both_initializers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called: list[str] = []

    def record(name: str) -> Callable[[], None]:
        def _inner() -> None:
            called.append(name)

        return _inner

    monkeypatch.setattr(telemetry, "init_sentry", record("sentry"))
    monkeypatch.setattr(telemetry, "init_otel", record("otel"))

    telemetry.init_all()

    assert called == ["sentry", "otel"]
