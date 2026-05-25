# P1a-codegen — Codegen MVP + Auth migration

**Status**: ✅ shipped (2026-05-06) — implementation to be replaced in P1b
**Depends on**: P1a-runtime, P0
**Unblocks**: P2a (incremental codegen). Note: P1d (Home + SomeController migration) waits for P1b's codegen rewrite, NOT this MVP — see P1d's "Depends on".
**Time**: shipped same day

## Goal (achieved)

End-to-end TS inference from schema → handler for `Auth.ts`. All 7 Auth handlers migrated; ~95 lines of hand-written intersection types deleted; `npm run cli generatetypes` regenerates types.

## How it actually shipped (vs original plan)

The original plan called for an AST scanner using the TypeScript compiler API. We chose a different path:

- **Runtime introspection over AST scanning**. `src/codegen/collectMetadata.ts` boots the framework with `isSkipModelInit: true` and a fake `httpServer = { express: parentApp }`, then walks `cm.controllers` to extract metadata. Express compiles the routes; we just read them. ~250 lines of helpers vs. the planned ~500-line AST scanner. No re-implementation of Express path matching, no TS-compiler-API dependency at runtime.
- **No standalone CLI binary**. Folded the codegen into the existing `GenerateTypes` framework command (`src/commands/GenerateTypes.ts`). One command emits both `genTypes.d.ts` (app-level) and per-controller `<File>.routes.gen.ts` (route-level). Invoked via `npm run cli generatetypes` (or the `gen` alias). The plan's `framework gen` CLI binary + `bin` entry never materialized.
- **Handler-method-named types over `Request<M, P>`**. The original plan had handlers write `req: Request<'post', '/login'>`, requiring two literals on every signature. We tested and rejected that — renaming a route's verb forces a handler-signature edit. Final form: codegen emits `<MethodName>Request` aliases (e.g., `PostLoginRequest`), one per handler method. Routes can move POST↔GET freely; handler signatures only churn when the method name changes (which the editor's rename refactor handles automatically).

## Files shipped

**New**:
- `src/services/http/types.ts` — P0 types (covered in `P0-type-contracts.md`).
- `src/codegen/collectMetadata.ts` — `collectMetadata(config)` boots the framework into an inspectable state and walks controllers; `extractControllerMeta(controller)` extracts metadata from a single instance (used by tests). Public types `ControllerMeta`, `RouteMeta`, `MiddlewareMapEntryMeta`, `MiddlewareRef`.
- `src/codegen/resolveChains.ts` — `resolveRouteChain(route, controller)` evaluates which Map entries match a route (Express 5 splat / param syntax + method scoping) and returns the ordered middleware tuple.
- `src/codegen/emit.ts` — `emitGenFile({ controller, srcPath })` renders metadata + chains into TS source. Reads the controller's source to copy import paths verbatim (gen file is a sibling). Conditionally includes `StandardSchemaV1` import + `<Class>Routes` alias only when at least one route has a schema.
- `src/tests/codegenMetadata.test.ts` — 5 tests covering Auth + SomeController metadata extraction.

**Edited**:
- `src/services/http/middleware/GetUserByToken.ts` — added `static get provides()` returning `{} as { user?: InstanceType<TUser> }`. Type-only phantom.
- `src/commands/GenerateTypes.ts` — `run()` now does both app-level (existing) and per-controller route-type generation. Composes `collectMetadata` → `resolveAllRouteChains` → `emitGenFile`.
- `src/controllers/Auth.ts` — all 7 handlers migrated to typed `<Method>Request` aliases (~95 lines of hand-written intersection types removed, +11 lines of typed imports).
- `src/helpers/files.ts` — auto-loader now also filters `*.gen.{ts,js}` files (alongside `*.test.*` and `*.d.ts`). Found via test failure: gen files in `src/controllers/` were being picked up as controllers.
- `cliCommand.ts` — explicit `process.exit(0)` after `cli.run()` resolves. Without this, lazy mongoose connections held by RateLimiter middleware kept the loop alive past the framework's 5s shutdown timer, which `process.exit(1)`'d and broke npm `&&` chains.
- `package.json` — `check:types` now `"npm run gen && tsc --noEmit"` (mirrors the example project's pattern); `prepublishOnly` regenerates before build; new `check:types:raw` for fast bare tsc.

## To be replaced in P1b

A code review of the MVP found 8 latent bugs, all stemming from re-implementing things the framework already knows (parsing controller imports, computing paths, resolving middleware chains heuristically). The fix is architectural — see `P1b-controller-carving.md`:

- `collectMetadata.ts`, `resolveChains.ts`, and `emit.ts`'s parser/path-heuristic code are torn down.
- Codegen rewrites to walk the new tree-based `RouteRegistry` directly. No source parsing, no path computation, no chain resolution heuristics.
- Output format flips from `.routes.gen.ts` to `.routes.gen.d.ts` (declarations-only — see `decisions.md` → "Codegen output is co-located").
- Gen files become gitignored again (the temporary "commit them as a baseline" was for diff-vs-rewrite during the redesign).

The MVP's user-facing surface carries over unchanged: `<MethodName>Request` aliases, `static get provides()` convention, gen file co-location, `GenerateTypes` CLI command, schemas inline in `routes` getter. Only the implementation underneath gets replaced.

## Test results (MVP)

- ✅ 137/137 tests (was 132 before P1a-codegen; +5 new metadata tests)
- ✅ `tsc --noEmit` clean
- ✅ `biome check` clean
- ✅ Cold-start verified: `rm src/controllers/*.gen.ts && npm run check:types` → regen + tsc passes from scratch

## Out of scope (deferred)

- **Step 3** — `postinstall` hook + lefthook pre-commit + `--watch` flag. The framework relies on `check:types` regenerating fresh, so step 3 is "nice to have" but not blocking. Worth picking up before we add more controllers that benefit from regen-on-save.
- **Per-vendor `toJsonSchema`** — P2a, drives OpenAPI emission.
- **Cross-controller middleware composition** — resolved structurally by the tree-based `RouteRegistry` in P1b (see OQ #13). The MVP's parser-based approach didn't capture parent middleware contributions to nested-controller types; P1b's tree walk does it by construction.
