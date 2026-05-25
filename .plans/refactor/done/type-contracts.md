# P0 — Type contracts

**Status**: ✅ done (2026-05-06)
**Depends on**: P−1
**Unblocks**: P1a-runtime, P1a-codegen (consumes the types), P1b (consumes the types)
**Time**: shipped same day

## What landed

`src/services/http/types.ts` (new, ~70 lines) exports:

- **`BaseAppInfo`** — built-in `appInfo` shape (`app`, `ip?`, `i18n`, `request`, `query`). `i18n` is **required** (not optional, as initially specced) since `I18nMiddleware` is in `HttpServer`'s default chain — handlers can rely on it. Users who remove I18n from their global chain augment `BaseAppInfo` to relax. Avoids `req.appInfo.i18n!` non-null assertions in user code.
- **`BaseRequestContext`** = `FrameworkRequest & { appInfo: BaseAppInfo & AppInfoExtensions }` — handler default context.
- **`AppInfoExtensions`** — empty interface, module-augmentation point for app-wide globals (e.g., `requestId`, `sentryTransaction`).
- **`ProvidesOf<T>`** — extracts `static get provides()` shape from a middleware class.
- **`UnionAppInfoProvides<MWs>`** — intersects `provides` shapes across a tuple, handles `[Class, params]` parameterized middleware tuples.

## Goal (achieved)

Land the type-only foundation that codegen output and the new tree-based `RouteRegistry` reference. Pure additive — no runtime behavior, nothing else depends on these existing yet.

## Files shipped

- `src/services/http/types.ts` (new) — the 5 types listed above. Pure type-only module.
- `src/services/validate/types.ts` (new) — `StandardSchemaV1` (inlined spec), `ValidationError` interface, `ValidationIssue`. Drove forward into P1a-runtime (validators).
- `src/index.ts` — exports the new types.

## Deferred to P1b (intentionally skipped here)

The original P0 plan included `Pipeline`, `Stage`, `RouteEntry`, `RouterAdapter`, `ValidatorBody`. These were pulled into P1b instead — they're load-bearing for the tree-based router and were better designed alongside the runtime than as standalone interfaces.

What replaces them in the new architecture (see `glossary.md`):
- `RouteEntry` → `HandlerEntry` (per-method) on `RouteNode` (tree-based)
- `RouterAdapter` → still an interface, but with one canonical implementation (`ExpressAdapter`) shipping in P1b as a single-mount adapter (~30 lines)
- `Pipeline` / `Stage` → land in P1b as the dispatch primitive
- `ValidatorBody` → not needed; `ValidatorDriver.canHandle(body)` covers the dispatch (P1a-runtime)

## API change

Net-new exports; nothing existing changes shape.

```ts
// src/services/http/types.ts
export interface BaseAppInfo {
  app: IApp;
  ip?: string;
  i18n: { t: TFunction; language: string };   // required, not optional
  request: Record<string, unknown>;             // populated by ValidationStage
  query: Record<string, unknown>;               // populated by ValidationStage
}

export interface BaseRequestContext {
  method: string;
  url: URL;
  params: Record<string, string>;
  headers: Headers;
  appInfo: BaseAppInfo & AppInfoExtensions;
}

export interface AppInfoExtensions {}  // user augments via `declare module`

export type ProvidesOf<T> =
  T extends { provides: infer P }
    ? P
    : T extends abstract new (...a: any[]) => any
      ? T extends { provides: infer P } ? P : {}
      : {};

export type UnionAppInfoProvides<MWs extends readonly unknown[]> =
  MWs extends readonly [infer Head, ...infer Tail]
    ? ProvidesOf<Head> & UnionAppInfoProvides<Tail>
    : {};
```

## Test plan (passed)

- ✅ `npm run check:types` (`tsc --noEmit`) passes.
- ✅ Importing `BaseRequestContext` etc. from `@adaptivestone/framework` resolves in synthetic consumer files.
- ✅ `UnionAppInfoProvides<[typeof MwA, typeof MwB]>` correctly intersects `provides` shapes — covered by `tests/types/contracts.test-d.ts` with type-level assertions.

## Out of scope

- **Any** runtime code (delivered).
- Codegen (P1a-codegen).
- Migration of existing controllers/middlewares (P1a-codegen for Auth, P1d for the rest).
- Pipeline / Stage / RouteEntry / RouterAdapter — deferred to P1b (above).

## Notes

- The original sketch had `i18n?: { ... }` (optional). Decisions.md → "BaseAppInfo.i18n required" settled it: required, with augmentation as the escape hatch for I18n-less stacks. The shipped type reflects this.
- `RouterAdapter` shape was the load-bearing question for this phase but ended up consolidated into P1b's tree-based design — single-mount Express adapter at `app.use(adapter)`, ~30 lines, swappable for future Hono/Fastify/native runtimes.
