"""Telemetry bootstrap for the analysis service.

Sentry and OpenTelemetry are both optional. This module is safe to import
even when their dependencies or environment variables are absent — all calls
become no-ops.

Enable Sentry by setting ``SENTRY_DSN``. Enable OTLP tracing by setting
``OTEL_ENABLED=true`` and ``OTEL_EXPORTER_OTLP_ENDPOINT``.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def init_sentry() -> None:
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        return
    try:
        import sentry_sdk  # type: ignore[import-not-found]
        from sentry_sdk.integrations.fastapi import (  # type: ignore[import-not-found]
            FastApiIntegration,
        )
    except ImportError:
        logger.info("sentry-sdk not installed; skipping Sentry init")
        return

    sample = float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.1"))
    sentry_sdk.init(
        dsn=dsn,
        traces_sample_rate=sample,
        environment=os.environ.get("APP_ENV", "development"),
        release=os.environ.get("RAILWAY_GIT_COMMIT_SHA"),
        integrations=[FastApiIntegration()],
    )
    logger.info("Sentry initialized (traces_sample_rate=%s)", sample)


def init_otel() -> None:
    if os.environ.get("OTEL_ENABLED", "false").lower() not in {"true", "1", "yes"}:
        return
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint:
        logger.info("OTEL_ENABLED=true but OTEL_EXPORTER_OTLP_ENDPOINT not set")
        return
    try:
        from opentelemetry import trace  # type: ignore[import-not-found]
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (  # type: ignore[import-not-found]
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.resources import Resource  # type: ignore[import-not-found]
        from opentelemetry.sdk.trace import TracerProvider  # type: ignore[import-not-found]
        from opentelemetry.sdk.trace.export import (  # type: ignore[import-not-found]
            BatchSpanProcessor,
        )
    except ImportError:
        logger.info("opentelemetry-sdk not installed; skipping OTel init")
        return

    resource = Resource.create(
        {
            "service.name": os.environ.get("OTEL_SERVICE_NAME", "phenosage-analysis"),
            "service.version": os.environ.get("RAILWAY_GIT_COMMIT_SHA", "unknown"),
        }
    )
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
    trace.set_tracer_provider(provider)
    logger.info("OpenTelemetry initialized (endpoint=%s)", endpoint)


def init_all() -> None:
    init_sentry()
    init_otel()
