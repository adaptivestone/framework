# P1j — Codegen zero-init

**Status**: ⏳ in flight (Phase 0 ✅ beta.49 · Phase 1 ✅ beta.52 · Phase 2 ✅ 2026-06-04, pending release). Phases 3–4 = v5.1 (not a v5.0.0 blocker).
**Release-readiness (2026-06-06)**: codegen convergence validated for the 5.0.0 tag — 21/21 codegen tests green; `npm run gen` + `tsc --noEmit` over the framework's own controllers clean (no warnings/deprecations); golden-fixture gate **hardened** with `Schemas` fixture locking the schema-output + params typing paths (`request:`/`query:` → typed `req.appInfo.request`/`.query`; `:id` → `req.params.id`) that the gate previously didn't exercise. No codegen bug surfaced — the recent beta.49–55 churn has settled.
**Depends on**: P1b ✅ (registry primitives)
**Time**: ~2 days across phases 1–4 (v5.1); ¼ day for phase 5 (v6)
**Origin**: 2026-05-24 deep-dive on codegen confirmed `skipWrap: true` already avoids middleware instantiation, but controllers, configs, and models still get loaded. Goal: codegen with zero side-effecting `new` calls.

## Goal

Make `npm run gen` execute pure source-file analysis. Zero middleware instances, zero controller instances (use prototype-only "ghost"), zero model imports for the appTypes scan. Today a 28-controller consumer codebase takes ~1132 ms of framework boot + ~26 ms of real codegen work. Target: cold <300 ms, warm <100 ms.

## Why

Codegen is structural type extraction. It has no business firing constructors, opening Redis clients, or running module-level side effects. Each of those is a class of bug we've paid for repeatedly:

- mongoose connections leaking past CLI exit (worked around with `process.exit(0)` in `cliCommand.ts`)
- 5-second shutdown stall (worked around with `.unref()` + force-exit timer)
- watch-loop restarts triggered by `.gen.ts` touches (worked around in consumer `nodemonConfig`)

Every workaround is evidence the foundation should never have allocated those resources in the first place.

## Phases

### Phase 0 — Extends-chain import walk ✅ (beta.49, 2026-05-24)

Walk `extends` ancestors when resolving middleware import paths in `emit.ts`. Child controllers inheriting `static get middleware()` from a parent now get the right `import type` lines in their `.routes.gen.ts`. 3 tests in `src/codegen/emit.test.ts`.

### Phase 1 — Static middleware schemas (= P1f v5.x bridge) ✅ (beta.52)

Implements the v5.x portion of [P1f](../later/static-middleware-cutover.md). Adds `static get relatedRequestParameters()` / `static get relatedQueryParameters()` to `AbstractMiddleware`, deprecates the instance form with a one-warn-per-class cache, framework middlewares migrated. After this lands, codegen no longer needs to instantiate middlewares to read schemas — the `skipWrap` option becomes purely a controller-side concern.

### Phase 2 — Ghost-instance controller introspection ✅ (2026-06-04, redesigned 2026-06-05)

Codegen reads each controller's `routes` / `getHttpPath()` from a prototype-only `Object.create(Class.prototype)` ghost (`app`/`prefix` defined, no constructor fired), then hands the ghost to the **existing** subtree builder — so route/middleware tree semantics live in one place and `RouteRegistry.flatten()` resolves cross-controller chains exactly as runtime does.

**Architecture (settled by a 4-lens design panel + adversarial critique, 2026-06-05):**
- `src/codegen/ghostController.ts` — the ghost lives in the **codegen layer** (out of the autoload folder; correct codegen→controllers dependency direction). Exports `ghostController(Class, app, prefix)`.
- `src/controllers/index.ts` — `registerController` is single-purpose (always `new`); new `registerControllerInstance(instance, prefix, {skipWrap})` is the seam runtime and codegen share; `loadControllerClasses()` made public so codegen drives its own load→register loop. Runtime middleware-schema helpers (`overridesInstanceSchema`, `warnInstanceSchemaDeprecated`) stay here (module-internal, no public path) — un-lumped from the codegen ghost.
- `src/helpers/deprecation.ts` — `makeOncePerClassWarner` in a **neutral** layer, shared by the runtime middleware-schema warner and the codegen ctor-routes warner (avoids a runtime→codegen import).
- No `introspect` boolean, no parallel data→tree builder, no `ControllerSpec`/OpenAPI abstraction (deferred until a real second consumer).

**Fallback, not loud-fail (non-breaking).** When a `routes` getter reads constructor-set state, the ghost read throws; `ghostController` falls back to a real `new` instance and emits a one-per-class `DeprecationWarning` (`ASF_DEP_CTOR_ROUTES`). Ships in v5.x; the fallback removal (ghost-only) moves to Phase 5/v6.

Audited against two real consumer codebases (`tht-server` 23 ctrls, `xtok-backend-2025` 18 ctrls): every `routes` getter is a declarative map of prototype handler refs → all ghost-safe today; the fallback is insurance. Verified: `npm run gen --throw-deprecation` exits clean (no fallback for framework controllers), generated output byte-identical, 4 tests in `src/codegen/ghostController.test.ts`.

Residual (accepted for v5.x): try/catch catches *throws* — a `routes` getter reading a constructor-set **scalar** without dereferencing it (e.g. `path: this.base + '/x'`) silently yields `undefined`; the v6 ghost-only cutover closes it.

### Phase 3 — Lazy model imports in appTypes

`appTypes.ts` currently `await import()`s every model file to detect `BaseModel`-vs-legacy. Replace with `static isBaseModel = true` marker on `BaseModel` + source-file regex parse (reuse `emit.ts`'s import parser). Zero model file imports during codegen.

### Phase 4 — Skip framework's own controllers in user codegen

`cm.initControllers({ skipFrameworkControllers: true })` short-circuits the internal folder scan. For user-codebase codegen, framework controllers (`Home`, `Auth`) aren't relevant types — they ship from `node_modules`. Cuts transitive imports (yup, mongoose, model files) those framework controllers pull in.

### Phase 5 — Remove workarounds (v6, requires P1f cutover)

- Drop instance schema getters from `AbstractMiddleware` (= P1f v6 cutover)
- Remove `skipWrap` option from `ControllerManager`
- Remove `process.exit(0)` from `cliCommand.ts`
- Clean up or restore the 5s force-shutdown timer (intentional safety, dropped by mistake in step-3 cutover)

## Files touched

| File | Phase | Change |
|---|---|---|
| `src/codegen/emit.ts` | 0 ✅ | extends-chain walk for import map |
| `src/codegen/emit.test.ts` | 0 ✅ | 3 tests |
| `src/services/http/middleware/AbstractMiddleware.ts` | 1 | static defaults + `@deprecated` on instance form |
| `src/services/http/middleware/Auth.ts` | 1 | migrate to static |
| `src/services/http/middleware/GetUserByToken.ts` | 1 | migrate to static |
| `src/services/http/middleware/RequestParser.ts` | 1 | migrate to static |
| `src/services/http/middleware/RequestLogger.ts` | 1 | migrate to static |
| `src/services/http/middleware/Pagination.ts` | 1 | migrate `related*Parameters` to static |
| `src/controllers/index.ts` | 1 ✅, 2 ✅, 4 | `#wrapHandlerEntry` static-first; single-purpose `registerController` + new `registerControllerInstance` seam; public `loadControllerClasses`; runtime middleware-schema helpers (module-internal); (Phase 4) `skipFrameworkControllers` |
| `src/codegen/ghostController.ts` | 2 ✅ | NEW — `ghostController()` (prototype ghost + fallback + `ASF_DEP_CTOR_ROUTES`), codegen layer |
| `src/helpers/deprecation.ts` | 1 ✅, 2 ✅ | NEW — neutral `makeOncePerClassWarner`, shared by runtime + codegen warners |
| `src/codegen/routeTypes.ts` | 2 ✅, 4 | drive `loadControllerClasses` → `ghostController` → `registerControllerInstance`; (Phase 4) `skipFrameworkControllers` |
| `src/codegen/ghostController.test.ts` | 2 ✅ | ghost-safe (no ctor) + fallback-with-warn + registerControllerInstance + runtime paths |
| `src/codegen/collectMetadata.ts` | 2 ✅ | unchanged — `extractControllerMeta` reads the ghost as-is (no static variant needed) |
| `src/codegen/appTypes.ts` | 3 | drop per-model `import()`; regex parse for `BaseModel` detection |
| `src/modules/BaseModel.ts` | 3 | `static isBaseModel = true` |
| `cliCommand.ts` | 5 | remove `process.exit(0)` |
| `src/server.ts` | 5 | clean up force-shutdown timer |
| `CHANGELOG.md` | each | per-phase entries |

## Out of scope

- Codegen file-based cache (paused mid-implementation in a prior session; separate next-session priority)
- Runtime codegen via server boot (orthogonal — would skip CLI boot entirely)
- AST-based `routes` extraction (Phase 2's ghost-instance is cheaper and gets us 95% there)

## Done when

| Phase | Verifiable in <5 min |
|---|---|
| 0 ✅ | `npx vitest run src/codegen/emit.test.ts` shows 3 passing |
| 1 ✅ | `npm test` green; framework middlewares all use `static get`; `#wrapHandlerEntry` reads static-first with cached instance fallback |
| 2 ✅ | `npx vitest run src/codegen/ghostController.test.ts` (4 passing): ghost read fires no ctor; constructor-dependent controller falls back to a real instance + emits `ASF_DEP_CTOR_ROUTES`; `registerControllerInstance` registers a ghost; runtime `registerController` still `new`s; `npm run gen --throw-deprecation` clean; output byte-identical |
| 3 | `node --inspect-brk` on `npm run gen` shows zero `import()` calls under `models/` outside the regex parser path |
| 4 | a fresh consumer project's `npm run gen` doesn't print framework-internal controllers in the "Found N controller(s)" log |
| overall | consumer codebase (28 controllers, 137 routes): cold `<300 ms`, warm `<100 ms` for `node cli.ts generatetypes` wall-clock |

## Trade-offs

- **Phase 1**: small framework cache for unmigrated user middlewares — one-time transition cost. Documented deprecation warning logged once per class.
- **Phase 2**: non-breaking. A `routes` getter that reads constructor-set state transparently falls back to a real instance + a one-per-class `ASF_DEP_CTOR_ROUTES` warning (not a hard fail — design changed from the original loud-fail plan). Migration: make `routes` independent of constructor state. Fallback removed in v6 (Phase 5).
- **Phase 4**: framework-shipped controllers won't have `.routes.gen.ts` files emitted into consumer projects. Correct — those types come from `node_modules` already.

## Risks

- **Phase 2**: if a user's `routes` getter genuinely needs constructor state, ghost-instance throws. Documented migration path: lazy-init inside handlers, not in `this` from the constructor.
- **Phase 3**: if user models extend `BaseModel` indirectly (`class X extends Y extends BaseModel`), `static isBaseModel` must propagate via inheritance. Verify with a 2-level extends test.

## Why this isn't P1f

P1f covers the architectural plan for static middleware metadata (the v5.x additive bridge → v6 hard cutover). P1j is the codegen-side perspective on the same problem plus the ghost-instance / lazy-imports / framework-controller-skip pieces that aren't middleware-related. Phase 1 of P1j and the v5.x bridge of P1f are the same implementation work, tracked from two angles — implementation lands once, both plans tick the box.
