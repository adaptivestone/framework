# P2b — Observability phases 2+: traces, correlation and diagnostics

**Status**: ⏸ deferred
**Depends on**: P1b (Pipeline),
[P1s Observability Phase 1 — metrics](../queued/metrics-seam.md)
**Unblocks**: nothing critical

## Goal (one-line)

Build traces, log correlation and operational diagnostics on the normalized route and metrics
foundation: OTel HTTP + mongoose spans, Sentry isolation-scope adapter,
`instrumentation-winston` trace-ID injection, `/livez` + `/readyz` with a check registry,
`diagnostics_channel` namespace, slow-handler/query logging and Pyroscope route auto-tag.

Prometheus export, `/metrics`, parameterized-route HTTP RED metrics and runtime process metrics are
owned by P1s and are no longer deferred to this all-at-once phase.

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §7c-i.

## Out of scope until activated

Skip until P1b ships and the Pipeline interface is stable.
