from __future__ import annotations

import logging

from app import telemetry


def test_init_sentry_noops_without_dsn(monkeypatch) -> None:
    monkeypatch.delenv("SENTRY_DSN", raising=False)

    telemetry.init_sentry()


def test_init_sentry_logs_when_sdk_missing(monkeypatch, caplog) -> None:
    monkeypatch.setenv("SENTRY_DSN", "https://example.invalid/1")

    with caplog.at_level(logging.INFO):
        telemetry.init_sentry()

    assert "sentry-sdk not installed" in caplog.text


def test_init_otel_noops_when_disabled(monkeypatch) -> None:
    monkeypatch.setenv("OTEL_ENABLED", "false")

    telemetry.init_otel()


def test_init_otel_logs_when_enabled_without_endpoint(monkeypatch, caplog) -> None:
    monkeypatch.setenv("OTEL_ENABLED", "true")
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)

    with caplog.at_level(logging.INFO):
        telemetry.init_otel()

    assert "OTEL_EXPORTER_OTLP_ENDPOINT not set" in caplog.text
