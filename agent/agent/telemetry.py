"""OTel SDK initialisation for the Proxim agent (F8 US2).

Exports a get_tracer() singleton. All graph modules import get_tracer() from here
to create spans; the tracer is a no-op when otel_exporter_otlp_endpoint is empty.
"""
from __future__ import annotations

import structlog

logger = structlog.get_logger()

_tracer = None


def init_telemetry(settings) -> None:
    """Initialise the OTel SDK and store a module-level tracer singleton.

    No-op (NoOpTracer) when otel_exporter_otlp_endpoint is empty.
    All errors are caught so telemetry failures never block daemon startup.
    """
    global _tracer
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        resource = Resource({"service.name": settings.otel_service_name})

        if not settings.otel_exporter_otlp_endpoint:
            provider = TracerProvider(resource=resource)
            trace.set_tracer_provider(provider)
            _tracer = trace.get_tracer("proxim-agent")
            logger.info("telemetry_noop", reason="no otel endpoint configured")
            return

        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

        exporter = OTLPSpanExporter(
            endpoint=settings.otel_exporter_otlp_endpoint,
            insecure=True,
        )
        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)
        _tracer = trace.get_tracer("proxim-agent")

        try:
            from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
            HTTPXClientInstrumentor().instrument()
        except Exception as exc:
            logger.warning("httpx_instrumentation_failed", error=str(exc))

        logger.info("telemetry_initialized", endpoint=settings.otel_exporter_otlp_endpoint,
                    service=settings.otel_service_name)

    except Exception as exc:
        logger.warning("telemetry_init_failed", error=str(exc))
        from opentelemetry import trace as _trace
        _tracer = _trace.get_tracer("proxim-agent")


def get_tracer():
    """Return the module-level tracer (no-op until init_telemetry() is called)."""
    if _tracer is not None:
        return _tracer
    from opentelemetry import trace
    return trace.get_tracer("proxim-agent")
