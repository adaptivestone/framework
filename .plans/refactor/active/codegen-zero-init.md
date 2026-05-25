# P1j — Codegen zero-init

**Status**: ⏳ in flight (Phase 0 ✅ shipped in beta.49, 2026-05-24)
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

### Phase 1 — Static middleware schemas (= P1f v5.x bridge)

Implements the v5.x portion of [P1f](../later/static-middleware-cutover.md). Adds `static get relatedRequestParameters()` / `static get relatedQueryParameters()` to `AbstractMiddleware`, deprecates the instance form with a one-warn-per-class cache, framework middlewares migrated. After this lands, codegen no longer needs to instantiate middlewares to read schemas — the `skipWrap` option becomes purely a controller-side concern.

### Phase 2 — Ghost-instance controller introspection

`extractControllerMeta`'s caller switches to `Object.create(Class.prototype)` with manual `prefix` patch — no constructor fires. New helper `extractControllerMetaStatic(ControllerClass, prefix)` in `src/codegen/collectMetadata.ts`. Runtime callers keep using real instances. Loud-fail if `routes` getter throws on a ghost — surfaces user code that mutates `this` in constructor.

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
| `src/controllers/index.ts` | 1, 2, 4 | `#wrapHandlerEntry` static-first; ghost option; `skipFrameworkControllers` |
| `src/codegen/collectMetadata.ts` | 2 | `extractControllerMetaStatic` |
| `src/codegen/routeTypes.ts` | 2, 4 | use ghost path; pass `skipFrameworkControllers` |
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
| 1 | `npm test` green; framework middlewares all use `static get`; `#wrapHandlerEntry` reads static-first with cached instance fallback |
| 2 | a controller with a throwing constructor is still introspectable by codegen (new test in `emit.test.ts`) |
| 3 | `node --inspect-brk` on `npm run gen` shows zero `import()` calls under `models/` outside the regex parser path |
| 4 | a fresh consumer project's `npm run gen` doesn't print framework-internal controllers in the "Found N controller(s)" log |
| overall | consumer codebase (28 controllers, 137 routes): cold `<300 ms`, warm `<100 ms` for `node cli.ts generatetypes` wall-clock |

## Trade-offs

- **Phase 1**: small framework cache for unmigrated user middlewares — one-time transition cost. Documented deprecation warning logged once per class.
- **Phase 2**: behavior change for users whose `routes` getter mutates `this` set by the constructor. Surfaced loudly via throw on ghost-instance read; cleaner than a silent skip. Migration: move state to lazy initialization inside handlers.
- **Phase 4**: framework-shipped controllers won't have `.routes.gen.ts` files emitted into consumer projects. Correct — those types come from `node_modules` already.

## Risks

- **Phase 2**: if a user's `routes` getter genuinely needs constructor state, ghost-instance throws. Documented migration path: lazy-init inside handlers, not in `this` from the constructor.
- **Phase 3**: if user models extend `BaseModel` indirectly (`class X extends Y extends BaseModel`), `static isBaseModel` must propagate via inheritance. Verify with a 2-level extends test.

## Why this isn't P1f

P1f covers the architectural plan for static middleware metadata (the v5.x additive bridge → v6 hard cutover). P1j is the codegen-side perspective on the same problem plus the ghost-instance / lazy-imports / framework-controller-skip pieces that aren't middleware-related. Phase 1 of P1j and the v5.x bridge of P1f are the same implementation work, tracked from two angles — implementation lands once, both plans tick the box.
