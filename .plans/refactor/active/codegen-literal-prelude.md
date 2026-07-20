# P1w — Literal route-getter setup

**Status**: 🟢 implemented 2026-07-20 · complete release gate green · awaiting `5.2.1`
**Target**: `5.2.1`, additive codegen compatibility
**Depends on**: shipped declarative OXC route extractor

## Goal

Let a controller read typed configuration into initialized `const` bindings before returning its
literal route tree. This keeps route-local middleware policies readable without broadening codegen
into control-flow evaluation.

## Delivered behavior

- A getter may contain zero or more initialized `const` declarations followed by one final literal
  return.
- Destructured config reads are accepted; route-level middleware pairs can retain tuple typing with
  `as const`, while codegen unwraps that annotation and extracts only the middleware class binding.
- `let`/`var`, uninitialized declarations, logging statements, loops, conditionals, computed route
  shapes, and dynamically constructed middleware remain unanalyzable and are skipped with a warning;
  bare side-effect statements, control flow, and post-return declarations are pinned by regression
  tests.
- A skipped controller that still has a previously generated `.routes.gen.ts` beside it escalates to
  an error-level stale-file message naming the file; the file is left in place so consumer imports
  keep resolving. Routine skips (no gen file on disk) keep the plain warning.
- Static middleware maps and literal `getHttpPath()` extraction use the same conservative helper.

## Files

- `src/codegen/astExtract.ts` + tests — optional initialized-constant prelude.
- `src/codegen/index.ts` + `appTypes.ts` (`CodegenLogger.error`) — stale-gen-file escalation.
- Example controller and controller-agent guidance — typed route-level policy usage.
- Canonical middleware documentation and changelog.

## Out of scope

- Evaluating variables or substituting values into route keys, handlers, or middleware classes.
- Executing application code during route-type generation.
- Changing the established skip-with-warning behavior for other dynamic controllers.

## Done when

- A typed config read followed by a literal route return generates request types.
- Mutable setup and control flow remain rejected.
- Framework checks, focused/full tests, example type generation, and docs build pass.

## Verification

- Framework format/type/build, 145 focused tests, and package-consumer smoke pass.
- A locally packed framework generated the example's request types: the policy-backed route kept
  its `RateLimiter` contribution, TypeScript passed, and OpenAPI emitted Pagination parameters.
- Full Vitest: 72 files, 693/693 tests; framework node:test: 7/7; example node:test: 4/4; docs build
  passes.
