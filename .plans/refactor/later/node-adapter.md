# P3 — `NodeAdapter` (drop Express router)

**Status**: ⏸ deferred
**Depends on**: P1b, P2c
**Unblocks**: P4

## Goal (one-line)

Native `node:http` adapter — no Express. `URLPatternAdapter` option. CI runs both alongside `ExpressAdapter`. Streaming response helpers (`streamSSE`, `streamJSON`). `undici` default outbound HTTP with shared Agent.

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §10 + the "long-term Express drop" passages in §3.

## Out of scope until activated

Skip until P2c's perf gate is met or explicitly skipped.
