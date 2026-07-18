# Spike — native HTTP engine benchmark ladder (Rust go/no-go)

**Status**: ⏸ queued (exploration — throwaway measurement, no framework source changes)
**Depends on**: P1b ✅ (tree router — `RouteRegistry`/`match` are engine-agnostic), P−1 ✅ (benchmark harness)
**Informs**: P2c (may justify skipping it), P3 `NodeAdapter` (rung 1 is its prototype), P4/P5 (whether a native adapter joins the pluggable family)
**Origin**: 2026-07-05. Idea: routes + validation schemas are static data, so the HTTP layer (accept → parse → match → validate → reject-fast) could run in a native engine (Rust), with only matched+valid requests reaching JS handlers. Constraint from brainstorm: **invisible to consumers** — `npm install` unchanged, automatic JS fallback, no separately-deployed gateway. Two shapes qualify: in-process napi engine, or a **self-managed child-process sidecar** (Rust binary inside the npm package, spawned by the framework the way esbuild ships its binary, talking over a Unix domain socket).

## Roadmap fit

The pluggable HTTP module **is already the plan**: `ExpressAdapter` today; P3 adds `NodeAdapter` (+`URLPatternAdapter`), P4 makes it default, P5 drops Express and ships `BunAdapter`/`DenoAdapter` with the Web-Fetch `(ctx) => Response` handler contract. A Rust engine would simply be **one more adapter in that family** — so this spike doesn't design new architecture; it measures whether a *native* adapter earns its place, and what each step up actually buys:

- **Rung 1 below is a minimal P3 `NodeAdapter` prototype** — its numbers tell us whether P2c (find-my-way glue, explicitly "may be skipped entirely") is worth doing at all, and de-risk P3 early.
- **Rung 3 (Rust)** would target the same adapter contract (eventually P5's `(ctx) => Response`), never a parallel architecture.

## Question the spike answers

Does a native HTTP engine speed up framework apps enough — over the *already-planned* JS `NodeAdapter` — to justify maintaining one?

Honest prior (to be confirmed/refuted by numbers): Node's HTTP parser is already native (llhttp); tree match is sub-µs; precompiled validation ~1–2µs; the bulk of today's overhead is likely Express layer machinery, which P3 removes anyway. Real apps are Mongo-dominated (1–3ms/query), so native wins would appear in max throughput, CPU headroom, and p99 tails — not typical latency. napi/IPC kill-risk: the boundary crossing (building JS request data from Rust, or UDS round-trip) can eat the margin; measured before anything is built around it. Middleware stays JS regardless (`Auth`/`GetUserByToken`→Mongo, `RateLimiter`→Redis, `I18n`). Prior art: uWebSockets.js proves the native-core-under-JS-handlers shape; the open question is the marginal gain of *our own* Rust engine over adopting an existing native core.

## Decision rule (agreed before running)

- Native rungs add **< ~25% marginal throughput on W-io (realistic decision workload)** over rung 1 → **no-go on Rust**; the spike's output becomes P3 input (JS `NodeAdapter` is enough; P2c likely skippable).
- Native core shows **≥ 2x on plaintext AND ≥ 20% better p99 or CPU-per-request on W-io** over rung 1 → Rust graduates to a productionization plan (prebuild matrix, automatic JS fallback, formal place in the adapter family).
- In between → judgment call with numbers on the table, explicitly including "adopt uWS as the native adapter instead of building Rust".

(Format mirrors P2c's perf gate, which stays authoritative for P2c's own scope.)

## Architecture — four rungs, one app contract

Lives in **`benchmark/engines/`**, extending the existing P−1 harness (fixtures + h2load scripts + local gitignored `baseline.json`) rather than a new spike folder. Bench-only deps (uWS, later the Rust crate) in a local `package.json`; excluded from build/publish. Throwaway measurement code; only rung 1 has a shipping path — via P3, not via this spike.

All rungs serve identical routes with identical responses:

- **Rung 0 — baseline**: the existing `benchmark/fixtures/realistic.ts` framework app (Express adapter), measured with default and minimal middleware chains — so gains elsewhere aren't just absent middleware in disguise.
- **Rung 1 — `NodeAdapter` prototype (the control)**: raw `node:http` + the real `RouteRegistry`/`match` from `src/` + precompiled validators, no Express. Isolates the Express tax. Doubles as the P3 de-risk.
- **Rung 2 — native core, no Rust**: rung 1's logic on uWebSockets.js. Isolates what a native socket/parse layer buys without writing any Rust.
- **Rung 3 — minimal Rust engine** (built **only if** rung 2 clears the bar: ≥ 25% marginal over rung 1 on W-io): tokio + hyper + matchit; route table + schemas handed from JS at boot; JS handler gets raw body bytes (JS does one `JSON.parse`; Rust validated on its own parse — the double parse is measured, not assumed away). Two candidate boundaries:
  - **3a — napi in-process**: ThreadsafeFunction callback, body as `Buffer`. Cheapest crossing (~µs), marshalling-heavy, napi prebuild matrix.
  - **3b — child-process over UDS**: framed binary protocol ("handler id, params, validated body"); Node stops being an HTTP server. Costlier crossing (~10–50µs), plain-binary build, process isolation, unlocks rustls TLS termination. Plain HTTP reverse-proxy variant explicitly out (double parse; nginx exists).
  - **Step 1 is a boundary bake-off micro-benchmark** (napi marshalling vs UDS round-trip at rate). Build only around the winner; if both taxes exceed the JS work replaced, stop there.

## Standard Schema vs native validation

Route validators are **Standard Schema** (`ValidateService` → `StandardSchemaDriver`): arbitrary JS functions, not inherently serializable. Per-library JSON Schema export is widely available (TypeBox *is* JSON Schema; zod 4 `z.toJSONSchema()`; Valibot `@valibot/to-json-schema`; ArkType native) — and the framework already has the vendor-neutral `toJsonSchema` driver seam from P2a (openapi-generator). Hard caveats: the Standard Schema spec defines no export interface (per-library dispatch — the P2a seam), and `.refine()`/`.transform()`/coercions can't convert. A real native engine therefore needs **per-route fallback: non-convertible schema → validate in JS**; realistic coverage for declarative CRUD schemas is high. W-val below uses a JSON-Schema-expressible schema deliberately.

## Workloads & measurement

Reuses the P−1 h2load harness and fixture style; adds what's missing:

- **plaintext** `GET /bench/plaintext` → existing fixture (floor: parse + match + respond). Baseline pinned: 16,591 req/s.
- **realistic** `GET /bench/echo?name=…` → existing fixture (query validation + i18n + JSON). Baseline pinned: 15,549 req/s.
- **W-val** `POST /bench/users` (new) → ~1KB nested JSON body + validation, echo subset. The validation path — where "Rust does validation" shines or doesn't.
- **W-io** `GET /bench/items/:id` (new) → ~2ms simulated async I/O + small JSON out. **The decision workload** — the Mongo-shaped proxy.

Metrics per rung: req/s, p50/p99, **CPU% at fixed pinned RPS** (~70% of rung 0's max; headroom matters more than max throughput), memory. h2load from a separate process; 5 runs, medians; quiet machine per P−1 notes. macOS numbers indicative — close margins re-run in the example project's Linux Docker setup.

**Correctness gate**: before benchmarking, a conformance script asserts each rung returns byte-identical status/body for all four workloads **plus a 404 miss and a 400 validation failure**. No benchmarking servers that cheat.

## Deliverables

1. `benchmark/engines/` — rung servers, conformance script, bench runner, raw results.
2. Results-and-decision doc: numbers, go/no-go per the rule above, plus consequences for the roadmap — keep/skip P2c, P3 timing, whether a native adapter (uWS or Rust) joins P3/P5's adapter family. If go: productionization sketch (prebuild matrix, automatic JS fallback, adapter-contract integration) and a **"nice features" section** (HTTP/2/3, rustls TLS termination, edge rate-limiting, zero-downtime socket handoff) so the decision weighs features, not just req/s.

## Out of scope (this spike)

No framework source changes; no TLS/HTTP2; no middleware ported to Rust; no packaging/prebuild work; nothing ships — rung 1 graduates only via P3, a native adapter only via its own follow-up plan.

## Done when

All rungs pass the conformance gate; the four workloads are measured across rungs 0–2 (and 3 if triggered); the results-and-decision doc exists with a go/no-go call against the pre-agreed thresholds.

## Open questions

- Where the decision doc lives when done (`.plans/refactor/reference/`?).
- If rung 1 wins outright: does that pull P3 forward on the roadmap (currently blocked by v6)?
