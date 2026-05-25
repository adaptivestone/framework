# P2b — Observability (full set)

**Status**: ⏸ deferred
**Depends on**: P1b (Pipeline)
**Unblocks**: nothing critical

## Goal (one-line)

OTel HTTP + mongoose spans, Sentry isolation-scope adapter, `instrumentation-winston` for trace_id auto-injection, `/livez` + `/readyz` with check registry, `/metrics` (prom-client) with parameterized-route RED histograms, `diagnostics_channel` namespace, slow-handler/query logger, Pyroscope route auto-tag.

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §7c-i.

## Out of scope until activated

Skip until P1b ships and the Pipeline interface is stable.
