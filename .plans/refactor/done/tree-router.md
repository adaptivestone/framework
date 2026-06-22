# P1b — Controller carving + Pipeline

**Status**: ✅ shipped (2026-05-10)
**Depends on**: P0
**Unblocks**: P1b-extras, P2a/2b/2c/2d (parallel)
**Time**: 2 days
**Parallelizable with**: P1a-runtime, P1a-codegen, P1c

## What shipped (2026-05-10)

- Tree-based `RouteRegistry` at `services/http/routing/` (`RouteNode`, `RouteRegistry`, `match`, `middlewareNormalization`, `ExpressAdapter`)
- Single-mount `ExpressAdapter` — one `app.express.use(...)` for the whole app
- `ControllerManager` (`src/controllers/index.ts`) owns translation as private methods (`#buildSubtree` + module-local helpers) — no separate `translateController.ts`
- `AbstractController.ts` shrunk to data-only base (~108 lines, data declarations + `getHttpPath()` only)
- Validation chain wraps handlers at registration time, merging route + middleware-declared schemas
- Codegen rewritten to use `RouteRegistry.flatten()` — single matcher between runtime and codegen
- 211/211 tests, tsc clean, biome clean
- Benchmark (2026-05-10, post-cutover): plaintext median 21k req/s (+28% vs P-1 baseline), realistic median 16k req/s (+5–10%)

### Trims vs original plan

- `setMatchOptions` / `registerGlobalMiddleware` / `GlobalMiddlewarePosition` — deferred to v5.1 when `bootHttp(app)` lands. Match options stay as a parameter on the standalone `match()` function.
- `MiddlewareParser.ts`, `RouteReporter.ts`, `pipeline/Pipeline.ts`, `pipeline/ValidationStage.ts` — not created. Translation + wrapping live in `ControllerManager` directly. Pipeline abstraction was speculative.
- `middlewareScope.ts` — not created. `resolveChains.ts` deleted entirely; codegen now reads middleware chains from `RouteRegistry.flatten()`, no parallel matcher.

## Goal

Replace Express's hidden router with an observable, tree-based `RouteRegistry`. Controllers contribute subtrees to a single global registry; the framework mounts exactly one Express middleware (`app.express.use(adapter)`) that delegates dispatch to our matcher.

Express becomes a transport (HTTP lifecycle, body parsing, response writing). Path matching, parameter extraction, method dispatch, and middleware ordering live in our code. Validation, error handling, and middleware execution become independent stages on the dispatch path.

`AbstractController.ts` shrinks from 461 lines to ~50 — controllers hold prefix + routes/middleware getters only; the global boot does the wiring.

Behavior preserved exactly — wire-level outputs of every existing test must match byte-for-byte.

## Files touched

- `src/services/http/routing/RouteNode.ts` (new) — `RouteNode`, `HandlerEntry`, `MiddlewareEntry` types. Pure types, no logic.
- `src/services/http/routing/RouteRegistry.ts` (new) — global tree of `RouteNode`s. APIs: `registerSubtree(prefix, node)`, `registerRoute(method, path, entry)` (ad-hoc escape hatch for webhooks/healthchecks), `registerGlobalMiddleware(mw, position?)`, `match(method, path) → MatchResult | null`, `walk(visitor)`, `flatten() → FlatRoute[]`. One instance per app, lives on `app.routeRegistry`.
- `src/services/http/routing/match.ts` (new) — simple tree-walk matcher (~50 lines). Static > param > splat specificity ordering. Replaceable by find-my-way in P2c via the same `match()` signature.
- **Translation lives inside `ControllerManager`** (private method, not a separate file): reads a controller's `get routes()` + `static get middleware()` Map, returns a `RouteNode` subtree. The boot flow is one cohesive workflow — load controller → translate → register — owned by `ControllerManager`. `routing/translateController.ts` exists during step 2 as a working implementation but its contents inline into `ControllerManager` in step 3. No new authoring shape planned — `get routes()` is the canonical user surface across v5 and v6.
- `src/services/http/routing/MiddlewareParser.ts` (new) — current `parseMiddlewares` from `AbstractController.ts:321-378`.
- `src/services/http/routing/middlewareScope.ts` (new — **created in P1b**) — Map-pattern scoping evaluator extracted from `AbstractController.ts:321-378`. P1a-codegen's MVP shipped its own scoping logic in `src/codegen/resolveChains.ts`; that file gets torn down as part of the codegen rewrite, and the new codegen + runtime both import from this canonical location.
- `src/modules/AbstractController.ts` — keep `getHttpPath()` as the URL prefix mechanism (default class-name derivation, overridable in subclasses). Codegen reads the value via runtime introspection on instantiated controllers — no separate path-resolution module or static field needed.
- `src/services/http/routing/RouteReporter.ts` (new) — the textual log table from `AbstractController.ts:277-299`.
- `src/services/http/pipeline/Pipeline.ts` (new) — flat-array stage runner.
- `src/services/http/pipeline/ValidationStage.ts` (new) — replaces the validation closure in `AbstractController.ts:184-269`.
- `src/services/http/pipeline/ErrorBoundary.ts` (new) — `ValidationError` → 400, throw → 500.
- `src/services/http/adapter/RouterAdapter.ts` (new) — interface (already declared in P0; concrete here).
- `src/services/http/adapter/ExpressAdapter.ts` (new) — wraps Pipeline → Express handler.
- `src/services/http/context/RequestContext.ts` (new) — hidden-class-stable ctx. Every field initialized in constructor (including `req.span = undefined`, even when OTel isn't installed).
- `src/services/http/HttpServer.ts` — add `app.useGlobal(MiddlewareClass, position?)` for app-level middleware (issue #12). The hardcoded chain at lines 56-74 (RequestLogger → PrepareAppInfo → IpDetector → I18n → Cors → RequestParser; the error handler at lines 77+ is separate) stays for built-ins; user code adds via `useGlobal`. **Ordering rules (must be in the implementation, documented in JSDoc)**:
  - `position?: NamedAnchor | RelativeAnchor | Shorthand` where:
    - `NamedAnchor = 'before-builtins' | 'after-builtins' | 'before-controllers'` (default: `'before-controllers'`)
    - `RelativeAnchor = { before: string } | { after: string }` — class name of a middleware already in `root.middlewares`
    - `Shorthand = 'first' | 'last'` — at the very start / end of `root.middlewares`
  - `'before-builtins'` — runs before `RequestLoggerMiddleware`. For things that need to wrap the entire request lifecycle (Sentry isolation scope, traceparent propagation).
  - `'after-builtins'` — runs after `RequestParserMiddleware` (line 77) but before any controller mounts.
  - `'before-controllers'` (default) — synonym for `'after-builtins'`; the common case for user middlewares that need parsed body/query.
  - `{ before: 'CorsMiddleware' }` / `{ after: 'I18nMiddleware' }` — fine-grained insertion relative to a named built-in or previously-registered middleware. Throws `ConfigError` if the named middleware isn't found.
  - `'first'` / `'last'` — shorthand for the absolute extremes of `root.middlewares`. Useful for plugins that need to be unconditionally first/last.
  - **Timing constraint**: `useGlobal` MUST be called *before* `initControllers` runs (i.e. before the framework's first controller binds via `app.httpServer.express.use(httpPath, this.router)` at `AbstractController.ts:314`). If called later, throws `ConfigError("useGlobal called after controllers were initialized — register globals during app boot, before initControllers")`. Validated at call time by checking a flag set when `initControllers` starts.
  - **Scope: registry-global middleware only.** The `position` API governs middleware on `registry.root.middlewares`. Per-controller middleware (declared in `static get middleware()` Map) is per-route-scoped by `translateController` at registration time — array order in the Map is the order; no cross-source `position` semantics apply at the controller level.
- `src/services/http/ProjectBootHook.ts` (new) — looks for user's `src/controllers/index.ts` (path resolved via `folderConfig`). If present, imports and calls its default export `bootHttp(app)` after the registry is initialized but before the Express adapter mounts. If absent, returns an inline synthesized default `bootHttp = (app) => app.controllerManager.loadAll()` — no separate file is created on disk; the synthesis lives in this module. Boot order: `HttpServer` → registry init → `ProjectBootHook.resolveAndRun(app)` → adapter mount. **⚠️ SHIPPED DIFFERENTLY (2026-06-22):** NOT a discovered file — it's an **explicit `Server` constructor option** `bootHttp(app)` (type `BootHttpHook`). File auto-discovery was dropped: every framework folder is already owned (config/ merges its files, controllers/ auto-loads its files), so there's no conflict-free folder to scan. Runs in `startServer` before mount; auto-load still runs unconditionally via `initControllers` (no synthesized `loadAll()` default). HTTP-specific. **No separate `ProjectBootHook.ts`** — the `BootHttpHook` type and the (trivial) call are inlined in `server.ts`. `useGlobal`/global middleware still deferred. See [glossary](../reference/glossary.md) + README.
- `src/services/http/middleware/RequestParser.ts` — read `req.routeMeta.bodyParsing` (`'parsed' | 'raw' | 'none'`, default `'parsed'`). When `'parsed'`: dispatch to a registered parser by Content-Type (json / multipart / urlencoded built-in; lenient fallback in v5). When `'raw'`: capture the request stream into `req.rawBody: Buffer` and skip parsing. When `'none'`: pass-through. Works because the dispatcher runs match-then-walk — matcher populates `req.routeMeta` BEFORE any middleware runs.
- `src/services/http/defaultControllerMiddleware.ts` (new) — moves the `Auth` + `GetUserByToken` defaults out of `AbstractController.ts:7-8`.
- `src/services/http/middleware/Auth.ts` — add `static authMiddleware = true` (phantom flag; not consumed by P1b runtime — read by P2d's MCP authz registration).
- `src/services/http/middleware/GetUserByToken.ts` — add `static authMiddleware = true` (same: phantom for P2d).
- `src/modules/AbstractController.ts` — shrink to ~50 lines: data-only. Constructor holds `app` + `prefix`; subclasses override `get routes()` and `static get middleware`. No more `express.Router()`, no more `this.router`, no more per-controller `httpServer.express.use(...)`. Global boot translates each controller's routes/middleware to a subtree and registers with `RouteRegistry`.
- `src/modules/Base.ts` — minor: any shared logger usage already in place.

## API change

```ts
// HttpServer boot — sketch:
const registry = new RouteRegistry();
app.routeRegistry = registry;

// Built-in global middleware (root.middlewares, in order)
registry.registerGlobalMiddleware(RequestLoggerMiddleware);
registry.registerGlobalMiddleware(PrepareAppInfoMiddleware);
registry.registerGlobalMiddleware(IpDetectorMiddleware);
registry.registerGlobalMiddleware(I18nMiddleware);
registry.registerGlobalMiddleware(CorsMiddleware);
registry.registerGlobalMiddleware(RequestParserMiddleware);

// User globals
app.useGlobal(SentryMiddleware, { position: 'before-builtins' });

// Controllers contribute subtrees
for (const Controller of controllerClasses) {
  const controller = new Controller(app);
  const subtree = controllerManager.buildSubtree(controller);
  registry.registerSubtree(controller.getHttpPath(), subtree);
}

// Single Express mount — the only routing mount in framework boot
app.express.use(createExpressAdapter(registry));
app.express.use(notFoundHandler);
app.express.use(errorHandler);

// AbstractController shrinks to ~50 lines:
class AbstractController extends Base {
  prefix = '';
  constructor(app: IApp, prefix: string) {
    super(app);
    this.prefix = prefix;
  }
  // Subclasses override: get routes(), static get middleware (unchanged shape)
}

// createExpressAdapter — ~30 lines (match-then-walk):
function createExpressAdapter(registry: RouteRegistry) {
  return async function dispatch(req, res, next) {
    // Step 1: match — runs FIRST, before any middleware
    const m = registry.match(req.method, req.path);
    if (!m) return next();
    req.params = m.params;
    req.routeMeta = m.entry;     // route-aware downstream (BodyParser, ValidationStage, OTel, …)

    // Step 2: walk middlewares with knowledge of the matched route
    try {
      for (const mw of m.middlewares) await runMiddleware(mw, req, res);
      await m.handler(req, res);
    } catch (err) {
      next(err);
    }
  };
}
```

User's `src/controllers/index.ts` (optional — framework synthesizes a default if absent):

```ts
import type { IApp } from '@adaptivestone/framework';
import SentryMiddleware from './middleware/Sentry';
import { stripeWebhookHandler } from './webhooks/stripe';

export default async function bootHttp(app: IApp) {
  // 1. Global middleware (writes into root.middlewares at the requested position)
  app.useGlobal(SentryMiddleware, { position: 'before-builtins' });

  // 2. Auto-load convention (filename → URL) — opt-in
  await app.controllerManager.loadAll();

  // 3. Programmatic registration (alternative to auto-load)
  // app.controllerManager.register(AuthController);
  // app.controllerManager.register(MyApi, { mountAt: '/v2' });

  // 4. Ad-hoc routes (escape hatch — webhooks, healthchecks, OAuth callbacks)
  app.routeRegistry.registerRoute('POST', '/webhooks/stripe', {
    handler: stripeWebhookHandler,
    bodyParsing: 'raw',     // raw bytes for signature verification
    middleware: [],         // no auth — verified by signature in handler
  });
}
```

## AbstractController simplification

`AbstractController.ts` shrinks from 461 lines to ~50. Becomes data + defaults only — `prefix`, `routes` getter, `static middleware`, `getHttpPath()`, `getConstructorName()`. No Express router, no validation closure, no route-registration loop.

### What stays / what moves

| Lines (today) | Responsibility | After P1b |
|---|---|---|
| 1-33 | Imports + types (`TMiddleware`, `RouteParams`, `RouteObject`) | **Stays** |
| 46-52 | Constructor — creates `express.Router({ mergeParams })` | **Deleted** |
| 53-89 | Read `routes`, build per-route middleware map, parse middlewares | → private method on `ControllerManager` |
| 96-104 | Register controller-level middleware on the router | → `RouteRegistry.registerSubtree()` |
| 109-256 | Route-registration loop (validation closure + handler wrap + 500 error) | → `pipeline/Pipeline.ts` + `ValidationStage.ts` + `ErrorBoundary.ts` |
| 262-285 | Build "Controller registered" log report | → `routing/RouteReporter.ts` |
| 286 | `app.httpServer?.express.use(httpPath, this.router)` | **Deleted** — single global mount in HttpServer boot |
| 298-336 | `#validateRouteSlot` | → `pipeline/ValidationStage.ts` |
| 341-398 | `parseMiddlewares` | → `routing/middlewareScope.ts` |
| 414-417 | `get routes()` default | **Stays** |
| 432-434 | `static get middleware` default | **Stays** |
| 439-446 | `getConstructorName()` | **Stays** |
| 451-453 | `getHttpPath()` | **Stays** — default URL derivation, overridable in subclasses |
| 455-457 | `static get loggerGroup` | **Stays** |

### Concrete sketch (target ~50 lines)

```ts
import type { IApp } from '../server.ts';
import type AbstractMiddleware from '../services/http/middleware/AbstractMiddleware.ts';
import Auth from '../services/http/middleware/Auth.ts';
import GetUserByToken from '../services/http/middleware/GetUserByToken.ts';
import Base from './Base.ts';

type MiddlewareWithParamsTuple = [typeof AbstractMiddleware, Record<string, unknown>];
export type TMiddleware = Array<typeof AbstractMiddleware | MiddlewareWithParamsTuple>;
type RouteHandler = Function;
type RouteObject = {
  handler: RouteHandler;
  description?: string;
  middleware?: TMiddleware | null;
  request?: (unknown & { fields: unknown }) | null;
  query?: (unknown & { fields: unknown }) | null;
};
export type RouteParams = {
  [method: string]: { [path: string]: RouteObject | RouteHandler };
};

class AbstractController extends Base {
  prefix = '';
  constructor(app: IApp, prefix: string) {
    super(app);
    this.prefix = prefix;
  }

  get routes(): RouteParams {
    this.logger?.warn('Please implement "routes" method on controller.');
    return {};
  }

  static get middleware(): Map<string, TMiddleware> {
    return new Map([['/{*splat}', [GetUserByToken, Auth]]]);
  }

  getHttpPath() {
    return `/${this.getConstructorName().toLowerCase()}`.replace('//', '/');
  }

  getConstructorName() {
    return this.prefix
      ? `${this.prefix.charAt(0).toUpperCase()}${this.prefix.slice(1)}/${this.constructor.name}`
      : this.constructor.name;
  }

  static get loggerGroup() { return 'controller'; }
}

export default AbstractController;
```

### Breaking changes to user-facing API

- Constructor: `(app, prefix, isExpressMergeParams?)` → `(app, prefix)`. The third arg goes away — params accumulate naturally in the tree walk. Hard break (cheap at 5.0.0-beta).
- `this.router` removed. No replacement — the registry owns routing. User code shouldn't have touched `this.router`; check via codebase audit.
- `parseMiddlewares` instance method removed → standalone function in `routing/middlewareScope.ts`.

## Test plan

- ☐ `npm run test` (existing suite) green.
- ☐ Diff `AbstractController.ts`: ~410 lines moved out, ~50 lines remain.
- ☐ Hit `/auth/login` with valid + invalid bodies; status codes + response bodies byte-identical to pre-refactor.
- ☐ `app.useGlobal(MW)` registers the middleware in the top-level Pipeline; verified via a synthetic test.
- ☐ **Subtree composition**: a controller with nested routes (e.g., `Admin` mounted at `/admin` registers `/users` and `/users/:id`) produces a correct `RouteNode` subtree under `/admin`; `registry.match('GET', '/admin/users/123')` returns the handler with accumulated middleware from root + `/admin` + `/users/:id`. Walk-order verified: root.middlewares → admin.middlewares → users.middlewares → param-bound :id node.middlewares → handler.middlewares → handler.
- ☐ **HEAD fallback**: a HEAD request to a GET-only route returns the same response status/headers as GET (no separate handler needed), per Express-compatible semantics.
- ☐ **405 with Allow**: a request method that isn't registered on a matched node returns 405 with an `Allow` header listing available methods (e.g., `Allow: GET, POST` for a node with GET and POST handlers).
- ☐ Removing `Auth` from `defaultControllerMiddleware` doesn't break controllers that opt in via their own `static get middleware()`.
- ☐ `RequestContext` constructor sets every field (including `req.span = undefined`). Two-layer test:
  - **Source-level lint** (CI-portable): a custom Biome/eslint rule (or grep regex) verifies the `RequestContext` constructor body assigns every property declared on the type. No node flags required.
  - **Runtime hidden-class probe** (opt-in, dev-only): `node --allow-natives-syntax tests/perf/request-context-shape.test.ts` constructs 1000 ctxs in varying orders and asserts `%HasFastProperties(ctx) === true` for all. Document the explicit command; not gated by default CI.
- ☐ **`ValidationError` byte-identical wire format** — fixture controller throws old (yup) and new (framework) `ValidationError`s with the same payload; the JSON returned from `AbstractController.ts:221-225` (`{ errors: err.message }`) is byte-identical between the two. (Cross-phase: this test also lives in P1a-runtime, but P1b's "byte-identical response" claim hinges on it.)

## Out of scope

- find-my-way / radix router (P2c).
- `fast-json-stringify` (P2c).
- Pre-compiled middleware chains as a *perf* optimization (P2c). The flat-array structure lands here; the perf-tuned compilation is P2c.
- Codegen integration (orthogonal — runs in P1a tracks).
- Streaming response helpers (P3).
- OTel `OtelStage` (P2b).

## Done when

- Existing test suite green; wire outputs byte-identical to pre-refactor.
- `AbstractController.ts` is ≤50 lines; no `express.Router()` reference inside it.
- Exactly one `app.express.use(adapter)` is the only routing mount in framework boot (no per-controller mount).
- `app.useGlobal(MW)` writes to `registry.root.middlewares` at the requested position.
- `registry.match(method, path)` resolves all currently-mounted routes correctly.
- `Auth` and `GetUserByToken` declare `static authMiddleware = true`.

## Notes

- The matcher in P1b is a simple tree-walk (~50 lines). find-my-way is a drop-in replacement in P2c — same `match()` signature, faster implementation.
- Translation is a **private method on `ControllerManager`** (not a separate file or method on `AbstractController`). Reads `get routes()` + `static get middleware()` Map, produces a `RouteNode` subtree. Keeps the boot workflow cohesive (load → translate → register all in one place) and `AbstractController` data-only (~50 lines). No new authoring shape planned — `get routes()` is the canonical user surface across v5 and v6.
- URL prefix resolution: `controller.getHttpPath()`. Default returns `/{constructor-name}`; subclasses override for custom paths. Codegen instantiates controllers via runtime introspection and calls the same method.
- Express's `req.params`, `res.json()`, `res.status()` API still works — only routing/dispatch is ours. Express middleware (body-parser, cors, helmet, compression, …) keeps running on `app.express.use(...)` BEFORE our adapter.
- Built-in framework middleware (Cors, I18n, IpDetector, PrepareAppInfo, RequestLogger, RequestParser) keeps the `(req, res, next)` Express signature. `MiddlewareEntry.run()` invokes them with that signature behind the adapter. Pipeline-native conversion is P3.
- HEAD falls back to GET (Express-compatible); OPTIONS handled either by `cors()` middleware or by an explicit handler on the node; trailing slashes lenient by default (collapse), opt-in strict per controller.
- **Match-then-walk dispatch**: the matcher runs FIRST (populating `req.routeMeta` with the matched `HandlerEntry` and params), THEN the middleware chain runs. This lets globally-registered middleware (`RequestParser`, `ValidationStage`, OTel) read `req.routeMeta` and adapt per-route. Without this, a global `BodyParser` would consume bytes before the route is even known — exactly the trap that forced xtok's monkey-patch.
- **Raw body**: `bodyParsing: 'raw'` on a route causes `RequestParser` to capture bytes into `req.rawBody: Buffer` and skip parsing. Settable on `RouteNode` (inherits down the subtree, leaf-wins) and on `HandlerEntry` (leaf only). Default `'parsed'` (auto-detect Content-Type) preserves today's behavior in v5.
- **Project boot hook**: framework looks for `src/controllers/index.ts` exporting `default async function bootHttp(app: IApp)`. If present, framework calls it after registry init, before the Express adapter mounts. If absent, framework synthesizes a default that calls `app.controllerManager.loadAll()`. The hook is where users register custom global middleware, ad-hoc routes (`registerRoute`), and custom subtrees — replaces today's pattern of monkey-patching prototype methods.
- **Ad-hoc routes**: `app.routeRegistry.registerRoute(method, path, entry)` is the escape hatch for routes that don't fit the controller convention. Same `HandlerEntry` shape — supports `bodyParsing`, route-level middleware, etc. Live runtime additions are supported but discouraged; prefer rebuilding the registry on file change.
- **Strict Content-Type acceptance**: `bodyParsing: 'parsed'` (default) accepts only `application/json`, `multipart/form-data`, `application/x-www-form-urlencoded`. Anything else → 415 with `Accept` header. Long-tail content types use `bodyParsing: 'raw'` (handler parses) or `'none'` (stream pass-through). Today's lenient formidable-anything behavior is replaced; migration audit is a grep on production codebases for non-JSON/non-multipart routes (expected hit count: near zero). Pluggable parser registry (`app.parsers.register(ct, parser)`) is P1b-extras / P3.
- **Multipart shape: always-array, scalar coercion via helper**. Parser runs formidable as-is and writes `req.body[name]: T[]` (matches formidable's natural output). Scalar fields wrap with `multipartScalar(inner)` from `src/helpers/multipart.ts`; array-shaped fields use the validator's native array type (`yup.array`, `z.array`, …). Cardinality-`0..N` fields (one-or-more values) work without ceremony — schema is `yup.array(yup.string())`, runtime arrives as `['x']` or `['x', 'y']`, both validate. `YupFile.check` flips from `Array.isArray(v) && v.every(i => i instanceof PersistentFile)` to `v instanceof File`; single-file is `multipartScalar(new YupFile())`, multi-file is `yup.array(new YupFile())`. Routes using `bodyParsing: 'raw'` cannot do file/field validation — the two modes are mutually exclusive. Replacing formidable with a transport-neutral parser is P3 (OQ #2).
- `src/helpers/multipart.ts` (new, ~15 lines) — exports `multipartScalar(inner)`: a Standard-Schema-conformant wrapper that unwraps single-element arrays before delegating to the inner validator. Vendor-neutral; no driver-side support needed.
- **Type generation is parser-agnostic**: codegen reads `StandardSchemaV1.InferOutput<typeof schema>` from the route's `request:` schema. The parser's runtime shape doesn't affect generated types. Multipart-vs-JSON is invisible at the type level; the schema is the single source of truth.
