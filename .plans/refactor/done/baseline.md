# P−1 — Baseline

**Status**: ✅ done (2026-05-03)
**Depends on**: nothing
**Unblocks**: P0
**Time**: ~½ day

## Goal

Pin the current performance numbers on the developer machine so every later phase can run the same fixtures and compare. Local-only — no CI gate, no shared runner. The baseline is for the maintainer's own before/after sanity check across the refactor.

## Files touched

- `benchmark/baseline.json` (new) — pinned numbers + metadata.
- `benchmark/fixtures/realistic.ts` (new) — boots the framework with a single benchmark controller; exercises the HTTP pipeline (route + middleware chain + yup validation + i18n lookup + JSON serialization). No mongoose, no Sentry.
- `benchmark/fixtures/controllers/Bench.ts` (new) — the bench controller. One GET endpoint with query validation that returns an i18n-translated message.
- `package.json` — add `dev:bench:realistic` (boots the fixture server) and `benchmark:realistic` (runs h2load against it) next to the existing `benchmark` script.

## Why no mongoose, no Sentry, no CI gate

- **No mongoose**: P0–P1d phases don't touch DB code. A `findOne` adds tens-of-ms variance per request and would swamp the µs-scale signal we're trying to measure (router/validator/middleware deltas).
- **No Sentry isolation scope**: not on the hot path in the current framework. Sentry today is only an optional Winston transport on logs, not a per-request scope wrapper. Add it back to the fixture if/when a per-request scope wrapper actually lands.
- **No CI gate**: GitHub Actions runners have ±10–30% noisy-neighbor variance, which makes a 5% gate flaky. Maintainer runs benchmarks locally on a quiet machine; numbers are committed to git so deltas are reviewable in PRs.

## API change

None. This phase doesn't touch source code under `src/`.

## Test plan

- ✅ `npm run dev:bench:realistic` boots without errors against `main`.
- ✅ `npm run benchmark:plaintext` runs and prints reqs/sec.
- ✅ `npm run benchmark:realistic` runs and prints reqs/sec.
- ✅ `benchmark/baseline.json` committed with `plaintext`/`realistic` reqsPerSec, hardware, OS, Node, commit, pinnedAt.

## Out of scope

- Any framework code changes.
- Any router/middleware/cache/codegen work.
- Choosing target numbers for later phases (those live in their phase docs).
- CI integration / regression gating.

## Done when

`benchmark/baseline.json` exists locally with both `plaintext` and `realistic` numbers, the benchmark scripts run end-to-end, and `cat benchmark/baseline.json` shows real numbers and metadata (hardware, OS, Node, commit, pinnedAt). The file is gitignored — it's the maintainer's local reference, not a shared artifact.

## Notes

- Run on a quiet machine. Close other apps. Run multiple iterations and take the best for the pinned number.
- The realistic fixture matters more than plaintext — plaintext just rules out router regressions in isolation.
- Numbers in `baseline.json` are pinned at one point in time. Re-run after each phase and update locally to compare.
