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


def test_init_sentry_invokes_sdk_when_available(monkeypatch, caplog) -> None:
    import sys
    import types

    monkeypatch.setenv("SENTRY_DSN", "https://example.invalid/1")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "0.42")
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "deadbeef")

    captured: dict[str, object] = {}

    fake_sentry_sdk = types.ModuleType("sentry_sdk")

    def fake_init(**kwargs: object) -> None:
        captured.update(kwargs)

    fake_sentry_sdk.init = fake_init  # type: ignore[attr-defined]

    fake_integrations = types.ModuleType("sentry_sdk.integrations")
    fake_fastapi = types.ModuleType("sentry_sdk.integrations.fastapi")

    class FakeFastApiIntegration:
        pass

    fake_fastapi.FastApiIntegration = FakeFastApiIntegration  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sentry_sdk)
    monkeypatch.setitem(sys.modules, "sentry_sdk.integrations", fake_integrations)
    monkeypatch.setitem(sys.modules, "sentry_sdk.integrations.fastapi", fake_fastapi)

    with caplog.at_level(logging.INFO):
        telemetry.init_sentry()

    assert captured["dsn"] == "https://example.invalid/1"
    assert captured["traces_sample_rate"] == 0.42
    assert captured["environment"] == "staging"
    assert captured["release"] == "deadbeef"
    integrations = captured["integrations"]
    assert isinstance(integrations, list) and len(integrations) == 1
    assert isinstance(integrations[0], FakeFastApiIntegration)
    assert "Sentry initialized" in caplog.text


def test_init_otel_logs_when_sdk_missing(monkeypatch, caplog) -> None:
    monkeypatch.setenv("OTEL_ENABLED", "true")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://otlp.example/v1/traces")

    with caplog.at_level(logging.INFO):
        telemetry.init_otel()

    assert "opentelemetry-sdk not installed" in caplog.text


def test_init_otel_initialises_provider_when_sdk_available(monkeypatch, caplog) -> None:
    import sys
    import types

    monkeypatch.setenv("OTEL_ENABLED", "1")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://otlp.example/v1/traces")
    monkeypatch.setenv("OTEL_SERVICE_NAME", "phenosage-analysis-test")
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "abc123")

    captured: dict[str, object] = {}

    # opentelemetry top-level
    fake_otel = types.ModuleType("opentelemetry")

    class FakeTrace:
        @staticmethod
        def set_tracer_provider(provider: object) -> None:
            captured["provider"] = provider

    fake_otel.trace = FakeTrace  # type: ignore[attr-defined]

    # exporter module
    fake_exporter_root = types.ModuleType("opentelemetry.exporter")
    fake_exporter_otlp = types.ModuleType("opentelemetry.exporter.otlp")
    fake_exporter_proto = types.ModuleType("opentelemetry.exporter.otlp.proto")
    fake_exporter_http = types.ModuleType("opentelemetry.exporter.otlp.proto.http")
    fake_exporter_trace = types.ModuleType(
        "opentelemetry.exporter.otlp.proto.http.trace_exporter"
    )

    class FakeOTLPSpanExporter:
        def __init__(self, *, endpoint: str) -> None:
            captured["exporter_endpoint"] = endpoint

    fake_exporter_trace.OTLPSpanExporter = FakeOTLPSpanExporter  # type: ignore[attr-defined]

    # sdk modules
    fake_sdk = types.ModuleType("opentelemetry.sdk")
    fake_sdk_resources = types.ModuleType("opentelemetry.sdk.resources")

    class FakeResource:
        def __init__(self, attrs: dict[str, str]) -> None:
            self.attrs = attrs

        @classmethod
        def create(cls, attrs: dict[str, str]) -> FakeResource:
            captured["resource_attrs"] = attrs
            return cls(attrs)

    fake_sdk_resources.Resource = FakeResource  # type: ignore[attr-defined]

    fake_sdk_trace = types.ModuleType("opentelemetry.sdk.trace")

    class FakeTracerProvider:
        def __init__(self, resource: object) -> None:
            captured["resource"] = resource
            self.processors: list[object] = []

        def add_span_processor(self, processor: object) -> None:
            self.processors.append(processor)

    fake_sdk_trace.TracerProvider = FakeTracerProvider  # type: ignore[attr-defined]

    fake_sdk_trace_export = types.ModuleType("opentelemetry.sdk.trace.export")

    class FakeBatchSpanProcessor:
        def __init__(self, exporter: object) -> None:
            captured["batch_exporter"] = exporter

    fake_sdk_trace_export.BatchSpanProcessor = FakeBatchSpanProcessor  # type: ignore[attr-defined]

    for name, mod in {
        "opentelemetry": fake_otel,
        "opentelemetry.exporter": fake_exporter_root,
        "opentelemetry.exporter.otlp": fake_exporter_otlp,
        "opentelemetry.exporter.otlp.proto": fake_exporter_proto,
        "opentelemetry.exporter.otlp.proto.http": fake_exporter_http,
        "opentelemetry.exporter.otlp.proto.http.trace_exporter": fake_exporter_trace,
        "opentelemetry.sdk": fake_sdk,
        "opentelemetry.sdk.resources": fake_sdk_resources,
        "opentelemetry.sdk.trace": fake_sdk_trace,
        "opentelemetry.sdk.trace.export": fake_sdk_trace_export,
    }.items():
        monkeypatch.setitem(sys.modules, name, mod)

    with caplog.at_level(logging.INFO):
        telemetry.init_otel()

    assert captured["exporter_endpoint"] == "https://otlp.example/v1/traces"
    resource_attrs = captured["resource_attrs"]
    assert isinstance(resource_attrs, dict)
    assert resource_attrs["service.name"] == "phenosage-analysis-test"
    assert resource_attrs["service.version"] == "abc123"
    assert isinstance(captured["provider"], FakeTracerProvider)
    assert isinstance(captured["batch_exporter"], FakeOTLPSpanExporter)
    assert "OpenTelemetry initialized" in caplog.text


def test_init_all_invokes_both_initialisers(monkeypatch) -> None:
    calls: list[str] = []

    monkeypatch.setattr(telemetry, "init_sentry", lambda: calls.append("sentry"))
    monkeypatch.setattr(telemetry, "init_otel", lambda: calls.append("otel"))

    telemetry.init_all()

    assert calls == ["sentry", "otel"]
