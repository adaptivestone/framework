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

## Parked idea — incremental codegen cache

Forward/reverse dep graph + `.cache/routes.json` + chokidar watcher (design in `_archive/REFACTOR_PLAN_v1.md` §5). **Parked 2026-06-21** — obviated by the AST front-end (P1n): a full codegen pass is already near-instant, so the cache would add ~330 lines + a stale-cache bug surface for no real win, and nothing runs codegen on a per-keystroke loop (it's wired into `check:types`, on demand). Revisit *only* if a very large consumer project reports a watch-mode pain point. (Moved here when the standalone `codegen-incremental` card was retired; its testing-utils half went to [test-helpers](../done/test-helpers.md).)
