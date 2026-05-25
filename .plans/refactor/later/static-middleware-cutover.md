# P1f — Static middleware metadata (breaking)

**Status**: ⏸ v6 cutover deferred · v5.x bridge ⏳ tracked in [P1j Phase 1](../active/codegen-zero-init.md#phase-1--static-middleware-schemas--p1f-v5x-bridge)
**Depends on**: P1b (RouteRegistry shipped)
**Time**: ~½ day for the v5.x bridge (under P1j), ~½ day for the v6 cutover
**Origin**: noticed during 2026-05-11 dogfooding against a consumer codebase (28 controllers, ~500 `MiddlewareEntry` references) — boot-time instantiation of middlewares to read instance-bound schema getters opens Redis clients / spawns timers / etc., 5-second shutdown stalls, and ~500 redundant instantiations per server boot.

## Goal

Move middleware schema declarations (`relatedRequestParameters`, `relatedQueryParameters`) from **instance** getters to **static** getters. The framework reads them off the class without ever calling `new`. Instances exist only at request time, only to call `middleware(req, res, next)`.

## Why

A middleware has two responsibilities:

1. **Declare metadata** — what shape it expects on `req.body` / `req.query`, what fields it provides on `req.appInfo`. This is **constant per class** — doesn't depend on `this.app`, `this.params`, or any per-instance state.
2. **Do work at request time** — auth check, populate `req.appInfo.user`, rate-limit. Needs an instance.

Today (1) and (2) share an instance. Reading the schema requires constructing the class. The constructor runs ALL of its setup — opening Redis clients (`RateLimiter`), wiring config (`Pagination`), etc. — even though we only wanted to peek at a static fact.

Result for a project like tht-server (28 controllers, ~500 `MiddlewareEntry` references in handler chains):
- ~500 middleware instances created at boot **just to read schemas** (thrown away after the read)
- All side effects fire 500 times
- 5-second shutdown stall on the codegen process because Redis connections keep the event loop alive

Static getters separate (1) from (2). Zero side effects to read metadata.

## API change

### v5.x (additive bridge — non-breaking)

`AbstractMiddleware` gets new static defaults alongside the existing instance ones:

```ts
class AbstractMiddleware extends Base {
  static get relatedRequestParameters(): StandardSchemaV1 | null { return null; }
  static get relatedQueryParameters(): StandardSchemaV1 | null { return null; }

  // existing instance getters stay, deprecated:
  /** @deprecated migrate to `static get relatedRequestParameters()`. */
  get relatedRequestParameters(): StandardSchemaV1 | null { return null; }
  /** @deprecated migrate to `static get relatedQueryParameters()`. */
  get relatedQueryParameters(): StandardSchemaV1 | null { return null; }
}
```

`ControllerManager.#wrapHandlerEntry` reads static-first:

```ts
function readSchema(MwClass, slot) {
  // Preferred: static — no instantiation, no side effects
  const staticVal = (MwClass as any)[slot];
  if (staticVal != null) return staticVal;

  // Fallback: instance — for unmigrated user middlewares
  // Cache by class, instantiate at most once per class lifetime
  if (!instanceSchemaCache.has(MwClass)) {
    warnOnce(MwClass, slot);
    instanceSchemaCache.set(MwClass, new MwClass(app, {}));
  }
  return instanceSchemaCache.get(MwClass)[slot];
}
```

Framework migrates its own middlewares immediately (`Pagination`, etc.) to static. User middlewares keep working; users see a deprecation warning logged once per class.

### v6 (breaking cutover)

Drop the instance fallback. `AbstractMiddleware` instance getters removed. Framework only reads `MwClass.relatedRequestParameters`. Unmigrated middlewares lose schema merging (no error — just no merging).

Documented migration: change `get relatedRequestParameters() { ... }` → `static get relatedRequestParameters() { ... }`. Mechanical, one-line per middleware.

## What this fixes

| Symptom | Status after v5.x | Status after v6 |
|---|---|---|
| Redis opened at boot when reading schemas | Fixed for migrated middlewares; one-time-only for legacy | Fully fixed |
| 5-second shutdown stall in codegen | Fixed (no per-route instantiation anymore) | Fully fixed |
| `skipWrap` codegen escape hatch | Becomes unnecessary | Remove |
| `process.exit` workaround in user `cli.ts` | Optional | Optional |
| ~500 redundant instantiations at boot | Drops to 1-per-unmigrated-class | Drops to 0 |
| `runMiddleware` instance cache by `MiddlewareEntry` | Separate fix (see "Out of scope") | Separate fix |

## Out of scope (separate phase)

- **WeakMap cache keyed by `(Class, JSON.stringify(params))`** — covered separately. Even with static metadata, `runMiddleware` at request time still creates instances. Caching by `(Class, params)` instead of per-`MiddlewareEntry` is the orthogonal improvement that gives request-time deduplication.
- **Awaitable-`next()` middleware contract** — separate v6 flip. Changes the runtime signature; this phase only touches metadata declaration.
- **`provides` type contract** — already documented; no change.

## Migration guide (user-facing)

For framework consumers, when v6 lands:

```ts
// BEFORE (v5.x — works but deprecated)
class MyMiddleware extends AbstractMiddleware {
  get relatedRequestParameters() {
    return yup.object({ foo: yup.string() });
  }
}

// AFTER (v6 — required)
class MyMiddleware extends AbstractMiddleware {
  static get relatedRequestParameters() {
    return yup.object({ foo: yup.string() });
  }
}
```

That's the entire migration. Single-keyword change per middleware class. Editor refactor handles it.

## Done when

- v5.x: `AbstractMiddleware` exposes static defaults, instance getters carry `@deprecated`, framework reads static-first, framework's own middlewares migrated, codegen no longer instantiates middlewares to read schemas, CHANGELOG entry, deprecation warning logged once per legacy class.
- v6: instance getters deleted from `AbstractMiddleware`, framework-side fallback removed, `skipWrap` option removed from `ControllerManager.initControllers` / `registerController` (and its caller in `src/codegen/routeTypes.ts`), user-facing migration guide in CHANGELOG.

## Trade-offs

- v5.x: framework grows a small instance-schema cache (one entry per legacy class). One-time cost during transition.
- v6: any user middleware not migrated loses schema merging silently. Migration is mechanical but users must do it.
- Architectural clarity: schemas are static metadata, period. Instances are runtime-only. The two roles no longer fight.
