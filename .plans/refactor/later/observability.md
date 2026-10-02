# P2b — Observability phases 2+: traces, correlation and diagnostics

**Status**: ⏸ deferred
**Depends on**: P1b (Pipeline),
[P1s Observability Phase 1 — metrics](../queued/metrics-seam.md),
[P1z vendor-neutral logging](../queued/logging-facade-and-pino.md)
**Unblocks**: nothing critical

## Goal (one-line)

Build traces, log correlation and operational diagnostics on the normalized route and metrics
foundation: OTel HTTP + mongoose spans, framework `LogRecord` trace-ID enrichment,
a health-check registry on top of the shipped `/health/live` + `/health/ready` ([health-endpoints](../done/health-endpoints.md), 5.5.0 — replaces the `/livez` + `/readyz` sketch),
`diagnostics_channel` namespace, slow-handler/query logging and Pyroscope route auto-tag.

Prometheus export, `/metrics`, parameterized-route HTTP RED metrics and runtime process metrics are
owned by P1s. Logger ownership, Pino JSON output, Error serialization, redaction, direct Sentry
delivery and sink lifecycle are owned by P1z. This phase enriches the framework-owned record with
active trace/span IDs; it does not install vendor instrumentation for a logger backend.

## Known problem: which services does `/health/ready` check? (no design yet)

Recorded 2026-10-02 with the maintainer; deliberately not designed.

- `/health/ready` checks only MongoDB — the one connection every app has (boot requires it).
- Optional connections are lazy: the shared Redis client (`helpers/redis/redisConnection.ts`) exists
  only once a cache driver, the rate limiter or app code asks for it, and nothing records which
  connections a running app actually uses. So the `Health` controller cannot know that Redis (or a
  queue, an external API) should be checked.
- Direction to explore: the same self-registration the connections already do for shutdown
  (`events.on('shutdown')` in the mongo, redis and logger code) — a service that opens a
  connection registers its health check, and the `Health` controller runs whatever is registered.
- Open questions: registry API and naming; per-check timeout; criticality (a cache-only Redis
  outage is degraded service, not a 503 — the rate limiter already falls back to memory); how apps
  register their own checks; the `checks` output shape; whether shutdown should move onto the
  same interface.
- Trigger: activate when an app needs a readiness check beyond MongoDB. This part does not depend
  on P1b and can be activated on its own.

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §7c-i.

## Out of scope until activated

Skip until P1b ships and the Pipeline interface is stable.
