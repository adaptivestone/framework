# P2b — Observability phases 2+: traces, correlation and diagnostics

**Status**: ⏸ deferred
**Depends on**: P1b (Pipeline),
[P1s Observability Phase 1 — metrics](../queued/metrics-seam.md),
[P1z vendor-neutral logging](../queued/logging-facade-and-pino.md)
**Unblocks**: nothing critical

## Goal (one-line)

Build traces, log correlation and operational diagnostics on the normalized route and metrics
foundation: OTel HTTP + mongoose spans, framework `LogRecord` trace-ID enrichment,
`/livez` + `/readyz` with a check registry,
`diagnostics_channel` namespace, slow-handler/query logging and Pyroscope route auto-tag.

Prometheus export, `/metrics`, parameterized-route HTTP RED metrics and runtime process metrics are
owned by P1s. Logger ownership, Pino JSON output, Error serialization, redaction, direct Sentry
delivery and sink lifecycle are owned by P1z. This phase enriches the framework-owned record with
active trace/span IDs; it does not install vendor instrumentation for a logger backend.

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §7c-i.

## Out of scope until activated

Skip until P1b ships and the Pipeline interface is stable.
