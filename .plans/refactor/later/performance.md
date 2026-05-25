# P2c — Performance (Express still default)

**Status**: ⏸ deferred
**Depends on**: P1b, P−1 (baseline)
**Unblocks**: P3

## Goal (one-line)

Drop Express's router for `find-my-way` (radix tree) behind `ExpressAdapter`; pre-compile middleware chains; lazy-getter `RequestContext`; `fast-json-stringify` per-route opt-in via `response` schema; mongoose pool defaults.

## Perf gate

≥3× plaintext baseline; ≥1.5× realistic-workload baseline. Both pinned in `bench/baseline.json` (P−1).

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §8.

## Out of scope until activated

Skip until P1b's Pipeline is stable. May be skipped entirely if perf isn't near-term — `find-my-way` integration glue is partially throwaway when P3 lands `NodeAdapter`.
