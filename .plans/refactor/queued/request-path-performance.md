# P1m-perf — JSON POST and Bun request-path cost

**Status**: queued 2026-11-02 · not started. The owner accepted the cost for 5.7
([P1m](../done/async-middleware.md) decision "Performance", A).
**Target**: any 5.x patch or minor; no API change, no behaviour change.
**Depends on**: [P1m](../done/async-middleware.md) (done), `benchmark/real-runner.mjs`.
**Origin**: the P1m real-runner re-measure against `5.6.0`.

## The gap

CPU per request, head − `5.6.0`, median of interleaved base/head pairs (5 s each, server pinned to
one core). Simple GET routes got faster (plaintext −23 to −30 µs), these did not:

| Route                           | Node 24        | Node 26        | Bun            |
| ------------------------------- | -------------- | -------------- | -------------- |
| `POST /bench/echo` (JSON + yup) | +35 µs (+17 %) | +51 µs (+28 %) | +39 µs (+33 %) |
| `GET /benchdefault` (401)       | −14 µs         | −33 µs         | +37 µs         |

## What is known

- Framework self time on the POST (Node 26 profile): 17.7 → 31.0 µs. About half is the 5.x
  bridge's per-request context (`expressContext`, `ExpressTransport`, staged headers, the context
  getters); the rest is spread thinly over `RequestParser`, `I18n`, `IpDetector`,
  `RequestLogger` and dispatch.
- The other ≈ 30 µs is unchanged library code (formidable, yup, `writev`, hashing) with higher
  per-call self time. Call counts are equal: one hash and one `writev` per request, the same
  `nextTick` count, the body already buffered when the parser attaches on both.
- Ruled out: connection reuse, extra writes or ticks, the parser's own code, `AbortController`
  (≈ 0.1 µs).
- One lead: running the parser before the chain instead of as its first layer measured ≈ −17 µs
  in a single noisy four-pair run. Not behaviour-neutral as tried: app-wide middleware must still
  wrap the parse, and parse errors must keep the chain's error path.
- Bun's 401 path is not profiled yet.

## Plan

1. **Measure on a quiet machine.** The shared VM varied ±25 µs between runs of one build — more
   than the budget. Give `real-runner.mjs` an interleaved mode (alternate base and head per run,
   report the median of pair deltas) and a `--routes` filter.
2. **Profile there:** Node 26 POST, and Bun's 401 and POST paths.
3. **Fix one site at a time**, each re-measured alone and covered by the existing suite: less
   per-request context work where only 5.x code runs, fewer promise hops in a parser-first chain,
   whatever the Bun profile shows.

## Done when

- The POST and Bun 401 deltas are within +4 µs CPU per request of `5.6.0`, or the remaining cost
  is traced to named sites and recorded as the floor of the 5.x bridge (which v6 removes).
- Full suite, `check`, type checks and both smoke tests green.
