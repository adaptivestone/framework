# P1v — Deterministic node:test server readiness

**Status**: ✅ shipped in `5.2.0` on 2026-07-20
**Target**: `5.2.0`, additive/fix
**Depends on**: runner-agnostic test lifecycle and the public test-helper export

## Goal

Prevent application root-level `before()` hooks from racing the framework's per-file server
bootstrap under `node:test`.

## Delivered behavior

- `ensureTestServerReady()` is public from `tests/testHelpers.js`.
- The framework preload and application hooks converge on one idempotent startup promise.
- Concurrent readiness calls cannot construct two test servers and resolve only after startup.
- A node-runner regression exercises a sibling root hook against the framework preload.
- Testing documentation covers hook placement, assertion plans, partial matching, one-shot mocks,
  and overloaded-method mock typing.
- Coverage thresholds remain enabled: Node 24.18.0 and Node 26.5.0 both exited non-zero when an
  intentionally unmet threshold was used with the documented dual reporters.

## Files

- `src/tests/setupFramework.ts`
- `src/tests/setupNodeTest.ts`
- `src/tests/testHelpers.ts`
- `src/tests/nodeRunner.node-test.ts`
- `scripts/packaging-smoke-test.sh`
- Framework changelog, canonical testing documentation, and the example project.

## Out of scope

- Wrapping or replacing Node's assertion and mocking APIs.
- Framework-owned coverage enforcement beyond Node's supported threshold flags.
- Changing the existing per-file server and per-run Mongo lifecycle.

## Verification

- `npm run check`
- `npm run check:types:raw`
- `npm run test:node` — 7/7 passing
- Full 5.2.0 release gate — 72 Vitest files (685/685); example node:test — 3/3 tests.
- Deliberately unmet branch coverage exits `1` on Node 24.18.0 and 26.5.0 with `spec` + `lcov`.
