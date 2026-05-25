# Glossary

Type and concept names that appear across multiple phase docs. Update this file before introducing a new name in a phase doc.

## Core types (P0)

- **`BaseRequestContext`** — the framework's "minimal request shape" interface; pre-augmentation. `appInfo` slot, `headers`, `method`, `url`, `params`. Source-of-truth declared in `src/services/http/types.ts`.
- **`RequestContext`** — `BaseRequestContext` after `AppInfoExtensions` augmentation; what handlers see when they don't import a per-handler `<MethodName>Request`.
- **`AppInfoExtensions`** — empty interface users augment via `declare module '@adaptivestone/framework'` to add globally-available `appInfo` fields (e.g. `requestId`, `sentryTransaction`).
- **`ProvidesOf<T>`** — type extractor pulling the `appInfo` shape a middleware adds (declared via `static get provides() { return {} as { ... }; }`).
- **`UnionAppInfoProvides<MWs>`** — reduces a tuple of middleware classes to the intersection of their `provides` shapes; intersected *into* `appInfo`, not at the request root.

## Routing (P1b — tree-based)

- **`RouteNode`** — node in the global route tree. Carries `{ segment, middlewares, methods, children, paramChild?, splatChild?, meta, bodyParsing? }`. Specificity ordering encoded structurally (static > param > splat).
- **`HandlerEntry`** — value at `node.methods[VERB]`. Carries `{ handler, request?, query?, middlewares?, bodyParsing?, meta }`. `meta` includes `methodName`, `controllerClass`, `sourceFile` for codegen + observability.
- **`MiddlewareEntry`** — `{ Class, params?, source }`. The `source` field carries `{ kind: 'package' | 'file', spec }` so codegen can emit the right import for the middleware class without source-file scanning.
- **`RouteRegistry`** — global tree (one per app, lives on `app.routeRegistry`). APIs: `registerSubtree(prefix, node)`, `registerRoute(method, path, entry)`, `registerGlobalMiddleware(mw, position?)`, `match(method, path)`, `walk(visitor)`, `flatten()`.
- **`RouterAdapter`** — interface bridging `RouteRegistry` to a transport engine. Implementations: `ExpressAdapter` (P1b, single-mount via `app.use(adapter)`); `NodeAdapter` (v5.1); `BunAdapter` / `DenoAdapter` / `WorkersAdapter` (v6+).
- **Match-then-walk dispatch** — the adapter runs `registry.match()` first (populating `req.routeMeta` and `req.params`), THEN walks the accumulated middleware chain. Lets globally-registered middleware (`RequestParser`, OTel, ValidationStage) read `req.routeMeta` and adapt per-route.

## Pipeline (P1b)

- **`Pipeline`** — flat-array stage runner. `Pipeline.dispatch(ctx)` walks stages index-by-index.
- **`Stage`** — `{ handle(ctx, next): Promise<Response> }`. Pipeline stages: `OtelStage` (P2b), `ValidationStage` (P1b), `ErrorBoundary` (P1b), and user middlewares (P1b).

## Validation (P1a-runtime)

- **`StandardSchemaV1`** — the [Standard Schema](https://standardschema.dev/) spec interface, inlined from the spec into `src/services/validate/types.ts` (no `@standard-schema/spec` dep). Any conforming schema (yup ≥1.7, zod ≥3.24, valibot, arktype, …) works as a `request`/`query` schema. The spec's `~standard.types.output` slot is the **schema-side TypeScript bridge** (extracted via `InferOutput`).
- **`ValidationError`** — framework-owned error **class** (shipped P1a-runtime in `src/services/validate/ValidationError.ts`). Replaces yup's `ValidationError` at framework layer. **Wire-format compatible** with yup's: `.message` holds the path-keyed payload (`Record<string, string | string[]>`) so `res.json({ errors: err.message })` produces the canonical `{errors: {fieldName: [msg]}}` shape. `.issues` is the structured list for logging.
- **`ValidatorDriver`** — interface with `canHandle(body)`, `validate(body, data)`, `toJsonSchema?(body)`. Functional plain-object drivers, no class hierarchy. Built-ins: `yupDriver` (vendor-aware strip-unknown), `standardSchemaDriver` (any other SS-conformant lib). Resolution order: **user-registered drivers (in registration order) → yup → standardSchema**. Users prepend via `ValidateService.register(driver)`; passing `'last'` appends instead. Schemas that match no driver throw at construction with a migration message — including legacy `{validate, cast}` plain objects (removed in 5.0; wrap as Standard Schema).

A schema/validator participates in three orthogonal concerns. The split:

| Concern | Where it lives | Mechanism |
|---|---|---|
| Runtime validation + cast | Driver | `driver.validate(body, data)` |
| Compile-time TypeScript types for handlers | Schema (Standard Schema spec slot) | `StandardSchemaV1.InferOutput<typeof schema>` |
| JSON Schema export for OpenAPI | Driver | `driver.toJsonSchema?(body)` |

## Body parsing (P1b)

- **`bodyParsing`** — per-route or per-`RouteNode` mode: `'parsed' | 'raw' | 'none'`. Default `'parsed'`. `'raw'` captures `req.rawBody: Buffer` and skips parsing (Stripe-style webhook scenarios). `'none'` leaves the request stream untouched (streaming handlers).
- **Parser registry** — `app.parsers.register(contentType, parser)`. Built-ins seeded at boot: `application/json`, `multipart/form-data`, `application/x-www-form-urlencoded`. User-registered parsers compose without monkey-patching.
- **`multipartScalar(inner)`** — Standard-Schema-conformant wrapper in `src/helpers/multipart.ts` that auto-unwraps single-element arrays before delegating to `inner`. Vendor-neutral; works with any validator. Used because multipart parsing always produces arrays for fields (formidable v3+ behavior).
- **`File`** — type alias exported from `@adaptivestone/framework/types`. Aliases `formidable.PersistentFile` today; will alias web-standard `File` after the busboy/web-`File` swap (P3 / OQ #2). User schemas reference `File`; framework ripple is one type-alias line.
- **`YupFile`** — yup-shaped helper in `src/helpers/yup.ts`. `YupFile.check` is `value instanceof File` (single-file semantics). Multi-file uploads use `yup.array(new YupFile())`.

## Boot + extension (P1b)

- **Project boot hook** — user-defined `src/controllers/index.ts` exports `default async function bootHttp(app)`. Framework calls it after registry init, before adapter mounts. If absent, framework synthesizes a default that calls `app.controllerManager.loadAll()`. Replaces today's pattern of monkey-patching framework prototypes.
- **`useGlobal(MW, { position? })`** — registers global middleware on `registry.root.middlewares`. Position: named anchors `'before-builtins' | 'after-builtins' | 'before-controllers'`, relative anchors `{ before: 'MwClassName' } | { after: 'MwClassName' }`, or shorthand `'first' | 'last'`.
- **Ad-hoc route registration** — `app.routeRegistry.registerRoute(method, path, handlerEntry)`. Escape hatch for routes that don't fit the controller convention (webhooks, healthchecks, OAuth callbacks).

## Generated artefacts (P1a-codegen, replaced in P1b)

- **`<File>.routes.gen.d.ts`** — per-controller TS declaration file emitted by codegen; co-located with the controller; gitignored. Exports per-handler request type aliases named `<MethodName>Request` (e.g., `PostLoginRequest`).
- **`genTypes.d.ts`** — root-level TS declaration file augmenting `IApp` so `getConfig('foo')` and `getModel('Bar')` are typed.
- Per-handler `<MethodName>Request` is `BaseRequestContext` ∩ `UnionAppInfoProvides<routeChain>` ∩ `{ appInfo: { request: <schema-output>, query: <schema-output> } }`. Schemas stay inline in the `routes` getter — codegen reads `InstanceType<typeof Controller>['routes']['<verb>']['<path>']['request']` via type navigation.

## Conventions

- **`get routes()`** — instance getter returning `{ method: { path: { request?, query?, handler, middleware?, bodyParsing?, ... } } }`. Stays instance — `static` would break `handler: this.method`. **Canonical authoring shape across v5 and v6** (no `get routeTree()` planned).
- **`static get middleware()`** — static getter returning `Map<patternKey, TMiddleware>` with path/method-scoped entries. Map shape preserved from today.
- **`static authMiddleware = true`** — phantom flag on a middleware class indicating that its presence in a route's middleware stack constitutes "authentication." Used by MCP authz (P2d) `requires` registration-time validation.
- **`static get provides()`** — instance phantom on middleware: returns `{} as <shape>` typing what the middleware *adds to `req.appInfo`*. Codegen reads this shape; runtime ignores it.

## Workflow

- **`npm run cli generatetypes`** (alias: `npm run gen`) — invokes the `GenerateTypes` framework command. Emits `genTypes.d.ts` (app-level) and per-controller `*.routes.gen.d.ts` (route-level) by walking the `RouteRegistry`. Folded into the existing CLI; no `bin` entry, no standalone binary.
- **`npm run check:types`** — `"npm run gen && tsc --noEmit"`. Regenerates gen files before type-checking. Fresh clones work via this script; postinstall hook is optional.
- **`bench/baseline.json`** — pinned plaintext + realistic-workload numbers from current `main`. Hard prerequisite for Phase 0 (P−1 produces it).

## Tiers (P2d MCP authz)

- **`requires`** per route: `'public' | 'authenticated' | 'admin' | string[]`. Asserted at registration against the route's middleware stack.
- **`sideEffect`** per route: `'read' | 'write' | 'destructive'`. Combined with `requires` for client-side gating.

## Versioning conventions

- **v5** — `5.0.0` final. Stays close to current Express-flavored behavior. Additive changes only. Tree-based router, codegen, validators, parser registry, project boot hook all ship in v5.
- **v5.1** — `NodeAdapter` opt-in (drops Express dependency, native Node + shim).
- **v6** — Aggressive default flips: `next()` → awaitable middleware, strict Content-Type default, trailing-slash strict default, case-sensitive default, `getHttpPath()` hard-removed.
