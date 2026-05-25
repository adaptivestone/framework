# Framework Refactor Plan

Living plan for the validator/controller/router refactor. Started 2026-05-03.

---

## 1. Goals

1. **Decouple validators from Yup.** User installs the library they want (Yup, Zod, Valibot, etc.) — or none. Yup becomes a peer/optional dep, not a hard runtime dep.
2. **Eliminate manual `req` type duplication in handlers.** Schema-derived and middleware-derived types should reach the handler automatically.
3. **Shrink `AbstractController`.** It currently does six jobs in one constructor. Split into pipeline + adapter, both engine-neutral.
4. **Prepare to swap Express.** Long-term goal: replace Express's router with `URLPattern` + native Node, eventually drop Express entirely.
5. **Keep `handler: this.method` working.** Class-method handlers stay the primary pattern. No forced rewrite of existing controllers.
6. **Make types generated, not inferred at user sites.** Codegen produces typed `.gen.ts` artefacts; user code reads from them. External tools (OpenAPI, client SDK) consume the same artefacts.
7. **Programmatic route introspection.** Every route's metadata (path, methods, schemas, middleware stack) is reachable at runtime. Drives Swagger/OpenAPI, doc sites, client SDKs, and external tooling.
8. **First-class testing utilities.** Spin up isolated apps with selected controllers, register ad-hoc test routes, and replace middlewares with stubs — all without booting an HTTP port.
9. **OpenTelemetry-ready.** Per-route and per-DB-call spans via a Pipeline stage and mongoose instrumentation. Optional peer dep — no overhead when not installed.
10. **Best-in-class Node performance.** Pre-compiled router (find-my-way / radix tree), pre-built middleware chains (no per-request closures), `fast-json-stringify` opt-in, hidden-class stable request context, undici-default outbound HTTP. Target: parity with or better than Fastify v5; demonstrable 4-9× throughput vs current Express baseline.
11. **Runtime portability via Web Fetch primitives.** The `Pipeline` consumes `Request` and produces `Response` (Web Fetch standard). `ExpressAdapter` adapts Node http; future `BunAdapter`, `DenoAdapter`, `WorkersAdapter` are thin glue. Buys Bun + Deno + Cloudflare Containers + Vercel Edge for free.
12. **LLM-native: framework-as-MCP, typed-code surface, agent-friendly errors.** Routes auto-export as MCP tools and as a typed TS client; 3 meta-tools (`list_endpoints`/`get_endpoint_schema`/`invoke_endpoint`) handle the >40-tool ceiling; errors include the CLI command to fix; non-interactive scaffolders for agents to invoke; minimal AGENTS.md.

## 2. Current state

### Validators

- Yup is a hard runtime dependency (`package.json:52`). Imported in `AbstractMiddleware.ts:2`, `ValidateService.js:1`, even `CustomValidator.js:1` (it throws Yup's `ValidationError`).
- Driver detection is implicit: `isSchema(body)` from yup → `YupValidator`, otherwise `CustomValidator` (`ValidateService.js:29-39`).
- All validator files are JS, not TS (`ValidateService.js`, `YupValidator.js`, `CustomValidator.js`, `AbstractValidator.js`).
- Schema introspection (`describe().fields`, `.tests`) is yup-specific (`YupValidator.js:9-39`). The doc generator depends on this.
- i18n translation is baked into `YupValidator.js:58-74` instead of being one cross-driver step.
- No TypeScript type inference into handlers — see `Auth.ts:69-77`, `:104-119`, `:163-166`, `:204-214`, `:237-246`, `:269-280` for six handlers redeclaring `appInfo.request` shape by hand.

### Controller

- `AbstractController.ts:46-316` constructor does: collects route middlewares, parses middleware shorthand, registers controller middlewares, registers each route with a validation closure, builds doc entries, prints a route table, attaches the express router.
- Express coupling is everywhere (`express.Router()`, `req`/`res`, `next`).
- `AbstractController.ts:7-8` hard-imports `Auth` and `GetUserByToken` middlewares for the default `static get middleware()`. After the carving, these defaults move to a separate `src/services/http/defaultGlobalMiddleware.ts` (or get dropped — they're framework-imposed defaults that the user should opt into).
- `parseMiddlewares` (`AbstractController.ts:321-378`) is a separate concern but lives in the same file.
- **Routes are declared as instance getters** (`Auth.ts:13` `get routes()`), and `AbstractController.ts:53` reads `const { routes } = this;` after `super()`. Codegen needs a static read; this is a real migration step (see §12).
- Folder→prefix→URL mapping is already correct in `controllers/index.ts:42-58` and `AbstractController.ts:431-433`. Two `Auth` controllers (root + `admin/`) coexist at runtime.
- **Existing controllers to migrate: 3** — `controllers/Auth.ts`, `controllers/Home.ts`, `controllers/test/SomeController.ts` (plus their `.test.ts` siblings). Plus middlewares: `Auth`, `GetUserByToken`, `RateLimiter`, `Cors`, `I18n`, `IpDetector`, `PrepareAppInfo`, `RequestLogger`, `RequestParser`.

### Cache

- Redis-only (`Cache.ts:7-30`). The file literally has the TODO: *"only redis. refactor for drives support in future"*.

### Tickets folded in

- **#9** Add object id validation — rescope to lib-agnostic Standard Schema implementation.
- **#10** Cache zero TTL — small, bundle with #13.
- **#11** Mongo ER diagram — independent, separate.
- **#12** Refactor: introduce global middlewares — directly subsumed by the new Pipeline.
- **#13** Cache: implement different drivers — same pattern as validator drivers.
- **#14** Cache for `getUserByToken` — depends on #13's memory driver.

## 3. Selected approach

After exploring three candidates (lean module-augmentation only / full tuple-typed phantoms / codegen) and reviewing Hono and TanStack Router for prior art, we picked:

- **Standard Schema** ([standardschema.dev](https://standardschema.dev/)) for the validator interface. Yup ≥1.7 and Zod ≥3.24 already implement it. Zero glue needed for either.
- **Declarative pattern, instance for routes (current shape preserved), static for class-level metadata.** `get routes()` stays as an *instance* getter — required because `static this.postLogin` is `undefined` (instance methods live on the prototype). `static get middleware()` stays as a `Map<string, TMiddleware>` — required because `SomeController.ts:163-167` uses path/method-scoped entries with parameterized middleware tuples. New static metadata for codegen: `static get provides()` on middlewares (typed phantom for what they add to `appInfo`), and an optional `static httpPath` on controllers (overrides the file-path-derived default — replaces today's `getHttpPath()` override pattern, e.g. `Home.ts:19`). Reuse `ExtractProperty` from `BaseModel.ts:18-22`.
- **Codegen** (TanStack-style) over runtime tuple-recursion. AST-scan controllers + middlewares, emit a `<File>.routes.gen.ts` next to each controller plus a global `routes.gen.ts` for tooling. Methods read types from the per-file `.gen.ts`.
- **`handler: this.method` stays.** No `defineRoute` is required for the inference story — the codegen carries the types instead. We *may* still ship `defineRoute` as an opt-in helper for inline route definitions, but it's not the primary path.
- **`Pipeline` + `RouterAdapter`** as the engine-neutral seam. Phase 1 ships `ExpressAdapter` only; later phases add `NodeAdapter`, then `BunAdapter`/`DenoAdapter`/`WorkersAdapter`. Internal request shape is **Web Fetch standard** (`Request`/`Response`); Express types are an escape hatch only.
- **`find-my-way` (radix tree) router**, the same one Fastify uses. Drop-in for Express's router behind `ExpressAdapter` in Phase 2c — closes most of the perf gap without dropping Express. Hono's RegExpRouter pattern (single compiled regex, O(1)) stays as a Phase 5+ option behind `SmartRouter`.
- **Pre-compiled middleware chains.** `RouteRegistry` flattens [global stages] + [controller MWs] + [route MWs] + [validation] + [handler] into a single array at registration; `Pipeline.dispatch` walks the array index-by-index. No per-request closure allocation.
- **Hidden-class-stable `RequestContext`.** Every field initialized in the constructor (the single biggest "free" V8 perf win). Lazy getters for expensive resources (`ctx.req`, `ctx.cookies`, `ctx.var`) — Hono's pattern.
- **Observability on by default.** OTel spans (HTTP + mongoose), `instrumentation-winston` for trace_id auto-correlation, `/livez`/`/readyz` health endpoints, `/metrics` with prom-client (parameterized routes only — strict cardinality), framework-owned `diagnostics_channel` namespace, slow-handler/query logger, Sentry adapter with `withIsolationScope`, Pyroscope route-tag hook. All optional peers; no overhead when not installed.
- **MCP-first agent surface.** `app.toMcpServer()` derives tools from `routes.gen.ts`. Three meta-tools (`list_endpoints`, `get_endpoint_schema`, `invoke_endpoint`) handle the >40-tool ceiling. Typed-TS client export from the same artefact for "code mode" agent execution. Errors-as-instructions; non-interactive `framework add ...` CLI.

### What this gets us vs. the alternatives

| | Lean (no codegen) | Tuples + phantoms | Codegen (chosen) |
|---|---|---|---|
| `handler: this.method` works | ✓ | ✓ | ✓ |
| Per-route precision for MW types | ✗ | ✓ | ✓ |
| Per-route precision for schemas | ✓ | ✓ | ✓ |
| TS compile speed | fast | slow on big MW tuples | fast (flat types) |
| External tools read route tree | ✗ | ✗ | ✓ |
| Drives docs / OpenAPI / client SDK | ✗ | ✗ | ✓ |
| Build step required | no | no | **yes** |

The build step is the only cost. Given the repo already ships `genTypes.d.ts`, runs `node --watch`, and is on Node ≥24, this is a fair trade.

## 4. User-facing API

### Validators

A schema is anything that conforms to Standard Schema. Yup ≥1.7 and Zod ≥3.24 work directly.

```ts
// lib-agnostic ObjectId schema (replaces ticket #9's YupObjectId proposal)
import { objectIdSchema } from '@adaptivestone/framework/validators/objectId';

// works with any Standard Schema schema:
import { object, string } from 'yup';      // or
import { z } from 'zod';                    // or
import * as v from 'valibot';
```

The framework throws a framework-owned `ValidationError` (in `src/services/validate/ValidationError.ts`), not Yup's. i18n translation moves to `ValidationStage`, run once after the driver returns issues.

### Controllers

```ts
import type { Request } from './Auth.routes.gen.ts';  // generated sibling

class Auth extends AbstractController {
  // Instance getter — unchanged from today. `this.postLogin` works because
  // it's an instance, and routes are read after `super()` constructs.
  get routes() {
    return {
      post: {
        '/login': {
          request: object({
            email: string().email().required('auth.emailProvided'),
            password: string().required('auth.passwordProvided'),
          }),
          handler: this.postLogin,                // method ref preserved
        },
        '/logout': this.postLogout,                // bare ref still works
      },
    } as const;
  }

  // Map preserved — `SomeController.ts:163-167` uses path/method scoping.
  // New: typed entries via the existing `TMiddleware` type.
  static get middleware(): Map<string, TMiddleware> {
    return new Map([
      ['/{*splat}', [GetUserByToken, RateLimiter]],
      // ['POST/admin', [RequireAdmin]] etc.
    ]);
  }

  // Optional explicit URL prefix override (replaces `getHttpPath()` overrides
  // like `Home.ts:19`). When absent, defaults to file-path-derived prefix.
  // static httpPath = '/auth';

  async postLogin(req: Request<'post', '/login'>, res: Response) {
    req.appInfo.request.email;     // string, from generated types
    req.appInfo.request.password;  // string, from generated types
    req.appInfo.user;              // UserInstance | undefined (from middleware Map)
  }
}
```

### Middlewares

```ts
class GetUserByToken extends AbstractMiddleware {
  // Phantom type returns the shape relative to `req.appInfo` — matches the
  // runtime, which sets `req.appInfo.user = ...`. The codegen intersects
  // this *into* `appInfo`, not at the request root.
  static get provides() {
    return {} as { user?: UserInstance };
  }

  // optional: schemas this middleware injects into validation
  static get relatedRequest() {
    return null;  // or a Standard Schema — replaces today's empty yup `object({})`
  }

  async middleware(req, res, next) {
    // existing runtime, sets req.appInfo.user
  }
}
```

### Global middleware (issue #12)

```ts
// app boot
app.useGlobal(SentryMiddleware);
app.useGlobal(RequestIdMiddleware);

// types for truly app-wide state via module augmentation
declare module '@adaptivestone/framework' {
  interface AppInfoExtensions {
    requestId: string;
    sentryTransaction?: Transaction;
  }
}
```

`AppInfoExtensions` is intersected into `RequestContext.appInfo` everywhere. One declaration covers every route.

### Cache

```ts
class Cache extends Base {
  driver: CacheDriver;        // Memory | Redis | (user-defined)
  // ...
}

// Memory is the default — no redis required at boot
// Redis becomes optional peer dep
```

## 5. Codegen design

### File layout

```
src/
├── routes.gen.ts                          ← global, for tooling/OpenAPI
├── controllers/
│   ├── Auth.ts
│   ├── Auth.routes.gen.ts                 ← per-controller, for handler types
│   └── admin/
│       ├── Auth.ts
│       └── Auth.routes.gen.ts             ← separately, no key collision
└── services/http/middleware/
    ├── GetUserByToken.ts
    └── RateLimiter.ts
```

The two-`Auth` case (root + `admin/`) coexists because each gets its own sibling `.gen.ts`. No global key collision; user code imports from the file next to it.

### Per-controller `.gen.ts` (sketch)

```ts
// AUTOGENERATED — do not edit
// src/controllers/admin/Auth.routes.gen.ts
import type { BaseRequestContext, UnionAppInfoProvides } from '@adaptivestone/framework';
import type GetUserByToken from '../../services/http/middleware/GetUserByToken.ts';
import type RateLimiter from '../../services/http/middleware/RateLimiter.ts';

// Codegen *resolves the Map at build time* — for each route's full URL,
// it finds which entries match (via path/method scoping) and emits the
// applicable MW tuple here.  This preserves the Map's scoping semantics
// while giving each route a flat tuple at the type level.
type LoginMiddlewares = readonly [typeof GetUserByToken, typeof RateLimiter];

export type Routes = {
  post: {
    '/login': {
      request: { email: string; password: string };
      query: {};
      middlewares: LoginMiddlewares;
      // Optional metadata. Codegen captures every known route field so external
      // tools (OpenAPI generator, MCP server, doc site) read from one source.
      description?: string;
      mcp?: {
        expose: boolean;
        sideEffect: 'read' | 'write' | 'destructive';
        requires: 'public' | 'authenticated' | 'admin' | string[];
      };
      response?: { /* response schema's output type, when declared */ };
    };
  };
};

// `provides` is intersected *into* appInfo — matches the runtime, which sets
// `req.appInfo.user = ...`, not `req.user`.
export type Request<M extends keyof Routes, P extends keyof Routes[M]> =
  BaseRequestContext & {
    appInfo:
      & UnionAppInfoProvides<Routes[M][P]['middlewares']>
      & {
          request: Routes[M][P]['request'];
          query: Routes[M][P]['query'];
        };
  };
```

Notes:
- `UnionAppInfoProvides<MWs>` reduces a tuple of MW classes to the intersection of their `provides()` shapes — which are declared at the *appInfo* level (§4 Middlewares).
- The flat per-route `middlewares` tuple is computed by the codegen by *evaluating the Map's path/method scoping rules at build time*: for each route, walk every entry in `static get middleware()`, check whether the entry's method/path pattern matches this route, and append the entries that match. This preserves today's Map semantics without leaking them into per-route types.
- Middlewares declared with parameters (`[RoleMiddleware, { roles: ['client'] }]`, `SomeController.ts:165`) reduce to `typeof RoleMiddleware` for type purposes — the params don't affect the `provides` shape.

### Global `routes.gen.ts` (for tooling)

```ts
declare module '@adaptivestone/framework' {
  interface RouteMap {
    'POST /auth/login':       { ... }
    'POST /admin/auth/login': { ... }
    // keyed by HTTP method + full URL — unique by construction
  }
}
```

External tools (OpenAPI generator, client SDK, doc site) iterate `keyof RouteMap`.

### Generator algorithm

For each controller file:

1. AST-parse with TypeScript compiler API (or `oxc-parser` for speed).
2. Find `get routes()` (instance getter), walk the object literal it returns.
3. For each `[method][path]` entry, capture `request`/`query` schema as `typeof <import>` references; the *output type* is computed by TS at compile time, not at codegen time.
4. Find `static get middleware()` returning a `Map`, walk the Map literal, parse each entry's path/method pattern (`'/{*splat}'`, `'PATCH/userAvatar'`, etc.).
5. **Compute the URL prefix.** Same algorithm as runtime, in priority order: (a) `static httpPath = '/...'` literal if declared; (b) `getHttpPath()` if its body is a single literal-string return (codegen AST-extracts it; emits a deprecation warning); (c) otherwise file-path-derived (`src/controllers/admin/Auth.ts` → `/admin/auth`). If `getHttpPath()` exists with a dynamic body, codegen errors out — see §12 for the migration path.
6. **Resolve middleware-Map scoping per route.** For each route registered in step 2, iterate each Map entry in step 4: parse the entry's pattern (`{splat}`, leading method, etc.), check whether the route's full method+path matches, and if so, append the entry's middleware classes to that route's effective MW tuple. Emit the resolved flat tuple per-route in `.gen.ts`.
7. For each MW class referenced, walk imports to find its `static get provides()` declaration; capture the type shape.
8. Emit `<filename>.routes.gen.ts` with `Routes` (per-route `request`/`query`/`middlewares`) and `Request<M, P>`.
9. Append the controller's routes to the global `routes.gen.ts` map, keyed by `'METHOD /full/path'`.

The generator does **not** evaluate user code (no module loading). It uses `typeof` references so the actual schema-output types are computed by TS at compile time. Pattern-matching the Map's scoping rules is pure string parsing against the same syntax `parseMiddlewares` already implements at runtime (`AbstractController.ts:321-378`) — extract that logic into `src/services/http/routing/middlewareScope.ts` so codegen and runtime share it.

### Incremental updates

Maintain two indexes:

```
forward:  controller → { middlewares: [...], schemas: [...] }
reverse:  middleware/schema → [controllers using it]
```

| Change | Action |
|---|---|
| Controller `.ts` saved | Regen its one `.gen.ts`. Update forward entry. Sync reverse. |
| Middleware `.ts` saved | Reverse-lookup → regen affected controllers' `.gen.ts`. |
| File deleted | Remove its `.gen.ts`. Drop from indexes. |
| New file created | AST-scan, add to indexes, generate. |
| Output unchanged | Skip write (output-hash short-circuit). Saves downstream HMR cycles. |

Persist `forward + outputHashes` to `.cache/routes.json`. On boot, compare current `mtime + content hash` against cached → regen only stale.

```
chokidar.watch([
  'src/controllers/**/*.ts',
  'src/services/http/middleware/**/*.ts',
  'src/schemas/**/*.ts',
], {
  ignored: ['**/*.gen.ts', 'node_modules', 'dist'],
})
```

Critically: **ignore `*.gen.ts`** in the watcher — otherwise regeneration triggers itself.

Logging:

```
[routes-gen] Regen src/controllers/admin/Auth.routes.gen.ts (cause: middleware/GetUserByToken.ts) 14ms
[routes-gen] Skip src/controllers/Other.routes.gen.ts (output unchanged)
```

Common-case: edit one controller → 1 AST parse + 1 file write, ~10–30 ms.

### Edge cases

- **Indirect deps via re-exports** (`middleware/index.ts` barrel) — resolve through re-export chains during AST pass.
- **Cyclic deps** — disallow at scan time, warn and refuse to generate.
- **Renamed file** — chokidar emits delete + create; treat as such.
- **Generator version bump** — invalidate `.cache/routes.json` schema; full pass.

### Generator code budget

- ~150 lines AST scan + emit (Phase 1 baseline)
- ~100 lines dep graph + reverse index + invalidation
- ~50 lines `.cache/routes.json` persistence
- ~30 lines watcher setup

~330 lines total, all build-time. Generator runtime ships only in dev-deps; the produced `.gen.ts` files **do** ship as compiled `.js`/`.d.ts` in `dist/` for the framework's own controllers (`Auth`, `Home`, `SomeController`) — they're real type-only source files, not "build artefacts" in the throwaway sense.

### `.gen.ts` lifecycle

To resolve the apparent contradiction ("gitignored" vs "user code imports them"):

- `.gen.ts` files are **TypeScript source files** containing types only (no runtime). They must exist on disk before `tsc` runs — they're imported by user controllers.
- They are **gitignored** to avoid merge conflicts and review noise — regenerated locally and in CI before any build step.
- **Required workflow**: `framework gen` runs **before** `tsc`/`vitest`/`biome check`. The dev-server watch mode regenerates on file change; CI runs `framework gen` as the first step of `npm run build`.
- A pre-commit hook (`lefthook.yml` already exists at repo root) runs `framework gen` to keep types fresh — committed code might still import from a missing `.gen.ts`, but the hook ensures local cleanliness before push.
- For **the framework's own published package** (`@adaptivestone/framework`), the `prepublishOnly` script runs `framework gen` → `tsc`; the resulting `.d.ts` files (built from `.gen.ts` types) ship in `dist/`. End users' apps generate their own `.gen.ts` for their own controllers.
- **Fresh-clone workflow.** `npm install` triggers `postinstall: framework gen` automatically — fresh clones produce working `.gen.ts` files before the editor opens. This applies to the framework repo itself and is the recommended template for user apps. Users who skip the postinstall (e.g. `npm install --ignore-scripts` in a sandbox) see a clear error from the first `import` of a `.gen.ts` file plus a one-liner in `README.md` ("If imports from `*.routes.gen.ts` are missing, run `npx framework gen`"). The dev server's startup also runs `framework gen` once before booting, as a belt-and-braces measure for `--ignore-scripts` cases.

### Codegen testing strategy

The generator is build-critical — silent miscodegen is catastrophic. Test it accordingly:

- **Golden fixtures** in `tests/codegen-fixtures/`. Each fixture is a tiny synthetic project: input `.ts` files + expected `.gen.ts` output. CI diffs the generator's output against the expected; PRs that change codegen update the goldens. Fixtures cover:
  - Plain controller + plain middleware + inline schema.
  - Schema imported from a sibling file (path resolution).
  - Schema imported through a barrel (`schemas/index.ts`).
  - Controller with no schemas at all.
  - Two same-named controllers in different folders (the `Auth` + `admin/Auth` case).
  - Re-exports through 2-3 barrel layers.
  - Cyclic import — generator must refuse, not loop.
  - Generic type parameters on a schema.
  - Decorators on the class (should be ignored, not crash).
  - File with no controller (should be skipped, not error).
- **AST edge-case tests** — synthetic ASTs that hit each branch of the walker (string-literal vs computed key, async-arrow vs function expression handler, missing `as const`, missing `static get middleware`, Map entries with method/path scoping, malformed middleware tuples with params).
- **Watcher race tests** — emit 100 file events in 10 ms; generator must converge to the same end state as one event per `await`. Use `chokidar`'s `awaitWriteFinish` and document the debounce window.
- **Output-hash short-circuit tests** — assert that semantically-equivalent input changes (whitespace, comment edits, reordering of `as const` keys) do **not** trigger downstream rebuilds.
- **Cross-platform path tests** — Windows `\` path separators in dep graph, case-insensitive filesystems on macOS.

### Route collision

`find-my-way` throws on duplicate `[method, path]` registration within the same router. The framework wraps the throw in a clearer error: `Route POST /auth/login is registered twice — first at controllers/Auth.ts:18, again at controllers/Auth.ts:42`. `RouteRegistry.bind()` is the canonical place to add this guard.

### `as const` is recommended, not enforced

Codegen reads the AST directly, so it always sees the literal strings/types regardless of `as const`. Runtime access (`this.routes`) doesn't depend on literal types either. `as const` only matters for users who navigate the routes object themselves at compile time via TS — a rare path. **No warning, no lint rule** — the framework's docs recommend it for users who want stronger inline types but doesn't enforce it. If there's ever evidence that users are tripping on the difference, revisit; until then, fewer warnings is better DX.

## 6. Internal refactor — `AbstractController` carving

```
src/services/http/
├── routing/
│   ├── RouteRegistry.ts        ← walks controller.routes, returns typed RouteEntry[]
│   ├── MiddlewareParser.ts     ← current parseMiddlewares, extracted
│   └── RouteReporter.ts        ← textual log table
├── pipeline/
│   ├── Pipeline.ts             ← runs (ctx, next) => Promise<Response> stages
│   ├── ValidationStage.ts      ← Standard Schema validation, populates ctx.request/query
│   └── ErrorBoundary.ts        ← ValidationError → 400, throw → 500
├── adapter/
│   ├── RouterAdapter.ts        ← interface: bind(RouteEntry[]) → engine handle
│   ├── ExpressAdapter.ts       ← Phase 1: today's behavior
│   └── URLPatternAdapter.ts    ← Phase 3
└── context/
    └── RequestContext.ts       ← framework-owned ctx (req, res facades)

src/modules/
└── AbstractController.ts       ← shrinks to ~50 lines: just declares routes/middleware
```

`AbstractController`'s constructor becomes a four-line orchestrator:

```ts
const registry = new RouteRegistry(this);
this.app.routerAdapter.bind(registry);
this.app.documentation?.push(registry.toDocumentation());
this.app.routeReporter.log(registry);
```

The `Pipeline`'s top-level slot is also where user-registered global middlewares (issue #12) plug in.

## 7. Runtime introspection, testing, observability

These three capabilities all hang off the same primitives — `RouteRegistry` and `Pipeline` — which is why they share a section.

### 7a. Route inspection / Swagger / OpenAPI

`RouteRegistry` is the runtime source of truth for every route. Expose it as a programmatic API:

```ts
app.routeRegistry.list();                     // RouteEntry[] — every route
app.routeRegistry.find('POST /auth/login');   // RouteEntry | undefined
app.routeRegistry.findByController(Auth);     // RouteEntry[] for one controller
```

Each `RouteEntry` carries: `method`, `path`, `fullPath`, `controller`, the merged middleware stack (global + controller + route), `request`/`query` schema instances, and optional metadata (`description`, `deprecated`, `tags`, `openapi` overrides).

Two consumers:

**Built-in OpenAPI generator** (`src/services/documentation/OpenApiGenerator.ts`) — replaces today's `DocumentationGenerator.js`. Reads the registry; runs per-vendor schema introspection via `~standard.vendor` dispatch (yup `describe()`, zod `z.toJSONSchema()`, valibot via `valibotToJsonSchema`); emits OpenAPI 3.1. Schemas without a known vendor get a placeholder + `// TODO`.

**External tools** read the static `routes.gen.ts` directly — same data, no runtime needed. Codegen + `RouteRegistry` are two views of the same model.

CLI:
```
npm run docs           # emits openapi.json from a running app (live data, e.g. enum values from config)
npm run docs:static    # emits from routes.gen.ts (no boot, faster, deterministic)
```

### 7b. Testing — runtime route registration + isolation

Two distinct concerns: running existing controllers in isolation, and registering ad-hoc routes during a test.

#### Isolated controller tests

```ts
import { createTestApp } from '@adaptivestone/framework/testing';

const app = await createTestApp({
  controllers: [Auth],
  config: { /* overrides */ },
  middlewareOverrides: new Map([
    [GetUserByToken, MockGetUserByToken],
  ]),
});

const res = await app.fetch('POST', '/auth/login', { body: { email, password } });
expect(res.status).toBe(200);
```

`createTestApp` wires only the requested controllers into a fresh `Pipeline`. **No HTTP port** — uses the `RouterAdapter` directly to dispatch a `RequestContext` through the stages. Faster than supertest, no port collisions in parallel tests.

#### Ad-hoc test-only routes

For tests that need a route the production code doesn't have:

```ts
app.routeRegistry.register({
  method: 'post',
  path: '/_test/echo',
  request: object({ msg: string().required() }),
  handler: async (req) => ({ echoed: req.appInfo.request.msg }),
});

const res = await app.fetch('POST', '/_test/echo', { body: { msg: 'hi' } });
```

This path is **inference-based** (uses `defineRoute` semantics under the hood), not codegen — test routes don't appear in `routes.gen.ts` and don't pollute production type artefacts. This is the main reason `defineRoute` ships even though codegen is the primary path: it's the API for ad-hoc/test routes.

#### Middleware override / replacement

```ts
app.middleware.replace(GetUserByToken, async (req, res, next) => {
  req.appInfo.user = mockUser;
  return next();
});
```

Replaces runtime only; types still come from `GetUserByToken.provides` (which is the contract). Tests don't lie about types.

### 7c. OpenTelemetry — per-route and per-DB-call spans

Goal: every request opens a root span; every DB call opens a child span; trace context propagates across framework boundaries.

#### Pipeline integration

OTel is a `Pipeline` stage wired before `ValidationStage`:

```ts
class OtelStage implements PipelineStage {
  async handle(ctx, next) {
    const tracer = trace.getTracer('@adaptivestone/framework');
    const span = tracer.startSpan(`${ctx.method} ${ctx.routePath}`, {
      attributes: {
        // Current OTel HTTP semconv (1.x stable) attribute names:
        'http.request.method': ctx.method,
        'http.route': ctx.routePath,           // parameterized, e.g. /users/:id
        'url.path': ctx.url.pathname,
        'url.scheme': ctx.url.protocol.slice(0, -1),
        'url.full': ctx.url.toString(),        // optional; redact if URL contains creds
      },
    });
    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const res = await next();
        span.setAttribute('http.response.status_code', res.status);
        return res;
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    });
  }
}
```

Span name uses the **parameterized** path (`ctx.routePath`), not the URL — bounds cardinality.

#### Mongoose / DB integration

Use `@opentelemetry/instrumentation-mongoose` (peer dep). Registers global hooks; no per-model code. Wired only when `@opentelemetry/api` is present.

#### Trace context propagation

`OtelStage` reads incoming `traceparent` header and continues the trace. Outbound HTTP (when the framework grows a client) propagates via standard W3C headers — OTel auto-instrumentation handles it.

#### Optional dep

OTel packages live in `peerDependenciesMeta` as optional. Lazy-import `@opentelemetry/api`; if missing, `OtelStage` becomes a no-op identity stage. Zero runtime overhead when the user hasn't installed OTel.

#### Custom span attributes

Handlers can enrich the active span without referencing OTel APIs directly:

```ts
async postLogin(req: Request<'post', '/login'>, res) {
  req.span?.setAttribute('app.login_method', 'password');
  // ...
}
```

`req.span` is **always declared** as a field on `RequestContext` (initialized to `undefined` when OTel isn't installed) — this is required for V8 hidden-class stability (§8d). Don't add the field conditionally; that creates two hidden classes for `RequestContext` and tanks inlining. Optional chain at the use site handles the `undefined` case.

### 7d. Built-in Sentry adapter

Sentry's Node SDK is now built on OTel — every span the framework emits is auto-picked-up. The framework provides one switch and the right-shaped scope:

```ts
// app boot
app.useSentry({ dsn: process.env.SENTRY_DSN });
```

This wires:
- `Sentry.withIsolationScope()` per request (prevents user/tag leakage between concurrent requests).
- Auto-tags `route`, `controller`, `request_id`; `setUser({ id })` when `req.appInfo.user` is populated.
- **Auto-disables Sentry's `httpIntegration` / `nodeFetchIntegration` / `mongooseIntegration`** so we don't double-instrument the same spans the framework already emits. Set `Sentry.init({ defaultIntegrations: false, integrations: [...keep-the-non-conflicting-ones] })` automatically — the user does not have to remember to turn things off. Override with `app.useSentry({ disableConflictingIntegrations: false })` if they really know what they're doing.
- Shares the OTel context. The framework's Sentry adapter is the single error-reporting source of truth.

### 7e. `/livez` and `/readyz` health endpoints

K8s convention; the framework ships them with a registry API:

```ts
app.health.register('mongo', async () => {
  await mongoose.connection.db.admin().ping();
});
app.health.register('redis', async () => {
  await app.cache.driver.ping();
});
```

- `/livez` — process-only check, ignores registered checks. Cheap; failure triggers pod kill.
- `/readyz` — runs all registered checks, JSON output `{ status, checks: [{ name, status, latencyMs, error? }] }`. Failure removes pod from service endpoints but doesn't kill it.
- `/startupz` — same registry but reports during the app's warm-up window.

### 7f. Metrics — `/metrics` with prom-client

The OTel HTTP semconv is strict about cardinality: `http.route` MUST be parameterized (`/users/:id`), MUST NOT be the URL path, and MUST NOT be set if the framework can't supply it. Since the framework owns route registration, it can always supply it.

```ts
// auto-wired when @adaptivestone/framework/metrics import is present
app.useMetrics({ defaultBuckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] });
```

- `collectDefaultMetrics()` for Node internals (event-loop lag, GC, heap).
- `http_server_request_duration_seconds` histogram (OTel-stable name) — labels: `http_request_method`, `http_route` (parameterized), `http_response_status_code`. Three labels max — bounded. Prom-client doesn't allow dots in label names; replace with underscores when emitting Prom metrics from OTel attributes.
- Per-route opt-in custom metrics via `req.span?.setAttribute('app.foo', value)` — exported through OTel, not Prometheus, to avoid label explosion.
- Dev-mode warning if a single route exceeds 50 distinct label combinations (catches accidental URL-path label).

### 7g. `diagnostics_channel` extension surface

Stable Node API since v18.13. Zero cost when no subscribers are attached — exactly the right tool for framework-specific deep hooks. The framework publishes a stable namespace:

```
@adaptivestone/framework:request.start
@adaptivestone/framework:request.finish
@adaptivestone/framework:handler.start
@adaptivestone/framework:handler.error
@adaptivestone/framework:route.matched
@adaptivestone/framework:validation.failed
@adaptivestone/framework:db.query
@adaptivestone/framework:db.slow
```

Stable payload shapes documented in `docs/diagnostics-channels.md`. APM vendors, custom logger plugins, slow-handler reporters, and tests all subscribe — none of them pay any cost when nobody listens.

### 7h. Slow-handler / slow-query logger

Default thresholds: 500 ms for handlers, 100 ms for mongoose queries. Output is a structured record (`trace_id`, route, sanitized params, duration, controller). On by default for queries; off by default for handlers (configurable).

### 7i. Pyroscope continuous profiling integration

Optional peer dep `@grafana/pyroscope-nodejs`. Framework auto-tags the active profile with `route` (parameterized) — flamegraphs become filterable per endpoint, which is the single biggest continuous-profiling productivity unlock.

```ts
app.useProfiler({ pyroscope: { serverAddress: '...', applicationName: 'api' } });
```

## 8. Performance

The current Express baseline benchmarks at ~9k req/s plaintext. Fastify v5 hits ~46k. Hono's RegExpRouter on Workers is ~400k. Realistic target for Phase 2/3: **40-50k req/s plaintext on Node 24, parity with Fastify**. The techniques are well-understood; we're not inventing anything.

### 8a. Router — find-my-way (proven), SmartRouter pattern (long-term)

**Phase 1**: drop Express's router; bind routes through `find-my-way` (radix tree). It's what Fastify uses, no caveats, no syntax limitations. Match cost is O(path-depth) and well below 1µs per request on modern hardware.

**Phase 3+ option**: Hono-style `SmartRouter` — try `RegExpRouter` (single compiled regex, O(1) match) at registration; fall back to find-my-way if syntax conflicts arise. Hono shows the pattern in [`honojs/hono` — `src/router/smart-router/router.ts`](https://github.com/honojs/hono/blob/main/src/router/smart-router/router.ts) — the rebind trick swaps `this.match` to the winning router after first request, eliminating dispatch overhead.

We don't need the SmartRouter trick in Phase 1; find-my-way alone closes 90% of the gap with Fastify.

### 8b. Pre-compiled middleware chains, no per-request closures

Express allocates a new `next()` closure per layer per request. Fastify pre-builds the chain at registration time. **At route registration**, `RouteRegistry` flattens [global stages] + [controller MWs] + [route MWs] + [validation stage] + [handler] into a single array; `Pipeline.dispatch(req, res)` walks the array index-by-index — no closures captured per request.

Hono uses recursive dispatch ([`honojs/hono` — `src/compose.ts`](https://github.com/honojs/hono/blob/main/src/compose.ts)); both shapes work, but a flat array is more predictable for V8 inlining. Use the array form.

### 8c. `fast-json-stringify` per-route opt-in

`response` schema attached at route registration → compile a stringifier once → per-request 1.6-2.4× faster JSON serialization on small payloads, plus the +10-20% throughput Fastify documents from response-schema serialization.

```ts
'/login': {
  request: loginSchema,
  response: object({ token: string(), user: userPublicSchema }),
  handler: this.postLogin,
}
```

Opt-in per route. When absent, falls back to `JSON.stringify` (which V8 also made ~2× faster in 2024).

### 8d. Request context — hidden-class stability

The single biggest "free" perf win in 2026 V8. The `RequestContext` constructor must initialize **every** field eagerly — even if `null`/`undefined`. No conditional `if (someFlag) ctx.foo = ...` on hot paths. This keeps V8's hidden classes monomorphic and inlined.

`ValidationStage` populates `ctx.appInfo.request` and `ctx.appInfo.query`; both fields are always set by the constructor (to `{}` placeholders), then overwritten. Same for `ctx.appInfo.user` (always declared, initially `undefined`).

### 8e. Lazy parsing patterns from Hono

Hono's Context defers expensive work via lazy getters ([`honojs/hono` — `src/context.ts`](https://github.com/honojs/hono/blob/main/src/context.ts)):
- `ctx.req` (HonoRequest) is undefined until accessed.
- `ctx.var` (Map for set/get) is undefined until used.
- `ctx.res` (Response) lazily allocated on first method call.

We do the same in `RequestContext`. Most routes don't touch `headers`/`cookies`/`var` — don't pay for them. Use `Object.create(null)` for hot-path lookup objects (no prototype chain).

### 8f. `undici` as the default outbound HTTP client

Node 22+'s `fetch` is undici under the hood, but `undici.request` direct + a shared `Agent` (connection pool) gives ~3× over `fetch`/`axios`/`got` for high-throughput proxying/webhook fan-out.

Framework exposes:
```ts
app.http.request(url, opts)   // direct undici call, shared pool
app.http.fetch(url, opts)     // standard fetch, same dispatcher
```

### 8g. Streaming responses

Accept either `Readable` (Node native) or `ReadableStream` (Web). Convert internally. Hono's `StreamingApi` ([`honojs/hono` — `src/utils/stream.ts`](https://github.com/honojs/hono/blob/main/src/utils/stream.ts)) is a clean reference for the `onAbort()` cleanup pattern.

```ts
'/feed': {
  handler: async (req, res) => {
    return streamSSE(async (stream) => {
      stream.onAbort(() => cleanupResources());
      for await (const item of feed) {
        await stream.writeSSE({ data: JSON.stringify(item) });
      }
    });
  },
}
```

### 8h. CPU-bound work via `piscina` (not bundled)

Worker-thread pooling for image/PDF/crypto-heavy work. Spinning a worker costs 1-3 ms; per-request creation is 4× slower than pooled. Document `piscina` integration but don't bundle — most apps don't need it.

### 8i. Minor wins

- `Object.create(null)` for hot-path key/value maps (route table, header map). Avoids prototype lookups; ~1-2% in microbenchmarks.
- Pre-compile and cache regex patterns at module scope; never per-request.
- Avoid `async` wrappers on functions that don't `await`. V8 still allocates a Promise.
- Mongoose pool defaults: `minPoolSize: 5, maxPoolSize: 50, maxIdleTimeMS: 30_000` — aligned with K8s replica counts.

## 9. LLM-friendliness — framework as agent surface

Routes are tools. Models are resources. The framework's `routes.gen.ts` is the perfect substrate for both — it's already typed, machine-readable, and authoritative. Three layers:

### 9a. `app.toMcpServer({ transport: 'stdio' | 'http' })` — built-in MCP

```ts
import { startMcpServer } from '@adaptivestone/framework/mcp';

await startMcpServer(app, {
  transport: 'stdio',
  include: ['users.*', '!users.delete*'],   // tag/path filters
  defaults: { responseFormat: ['concise', 'detailed'] },
});
```

Auto-derived tool definition per route:
- `name` = `<controller>.<method>` namespace (e.g. `auth.postLogin`)
- `description` = JSDoc above the controller method (or route's `description` field)
- `inputSchema` = merged body+query+params, exported as JSON Schema (Standard Schema → JSON Schema via lib-specific introspector)
- `outputSchema` = the route's `response` schema (when present)
- `sideEffect` = `'read' | 'write' | 'destructive'` — declared per route, controls client gating
- `hidden` = excludes from MCP exposure (default-true for `/admin`, `/internal`, auth flows)

Mongoose models expose as **MCP resources** with stable URIs (`mongo://users/<id>`):

```ts
User.toMcpResource({ readOnly: true, redact: ['password', 'sessionTokens'] });
```

### 9b. The "code mode" problem — typed-TS surface, not JSON tools

The 2025-26 paradigm shift: dumping all tool JSON Schemas into context is wrong. Anthropic's [Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) shows 98.7% token reduction (150k → 2k) by exposing tools as a **TypeScript module surface**, letting the agent grep/read only what it needs. Cloudflare's [Code Mode](https://blog.cloudflare.com/code-mode/) runs LLM-generated TS in V8 isolates against framework RPC bindings.

The framework supports both:

```ts
// generated alongside routes.gen.ts:
import { api } from '@adaptivestone/framework/client';

// Agent writes:
const user = await api.auth.postLogin({ email, password });
//                ^^^^^^^^^^^^^^^^^^^ fully typed, autocomplete works
```

`api.<controller>.<method>(input)` — derived from `routes.gen.ts`. Same artefact powers OpenAPI, MCP tools, the typed client, and code-mode bundles.

### 9c. The 40-tool ceiling — Stainless's three meta-tools

Real-world MCP servers degrade past ~40 tools (Cursor caps at 40; accuracy drops up to 85% with growth). Solution from Stainless: always expose three meta-tools alongside the per-route tools:

```ts
list_endpoints({ tag?, controller? })   → [{ operationId, summary, sideEffect }]
get_endpoint_schema(operationId)        → { description, inputSchema, outputSchema }
invoke_endpoint(operationId, args)      → result
```

The agent does **discovery** through these three tools instead of consuming the full tool list. Per-route tools stay available for power users; meta-tools handle scale.

### 9d. Errors as instructions

Error responses include the next-step CLI command (or code snippet) for the most common cause:

```json
{
  "error": "ValidationError",
  "field": "email",
  "expected": "string (email format)",
  "got": "number",
  "fix": "Send `email` as a string. Example: { \"email\": \"a@b.com\" }"
}
```

For 404s on missing routes, list the 3 nearest routes. For schema-introspection failures, embed `npx framework gen` as the fix.

### 9e. Non-interactive scaffolding CLI

```
npx framework add controller Users
npx framework add middleware RequireAdmin
npx framework add field users.email --type string --required
npx framework gen                       # rebuild routes.gen.ts
npx framework agents-md                 # write/refresh AGENTS.md
```

Non-interactive (no prompts — agents can't answer). Prints created file paths + next-step instructions to stdout. Generated files are minimal, idiomatic, and match the codebase conventions exactly.

### 9f. AGENTS.md generator

The Linux Foundation AGENTS.md spec is now standard across Claude Code/Cursor/Codex/Copilot/Windsurf. The framework's generator emits a **minimal, factual** template (under 50 lines) covering only non-inferable details: how to run dev/test/gen, where routes/controllers/middlewares live, the `*.gen.ts` "do not edit" contract, the scaffolding commands. Anecdotal reports suggest verbose AGENTS.md files can *reduce* agent success rates and add inference cost — verify before citing in user-facing docs; the conservative version of the rule ("keep it tight, document only non-inferable specifics") stands regardless.

### 9g. Authorization model — deny-by-default

`hidden` is *opt-out for visibility*, not authorization. The MCP surface needs a real authz story before Phase 2d ships, otherwise `app.toMcpServer()` is exposure-by-default.

**Default policy: deny.** A route is exposed via MCP **only if both**:
1. It is not `hidden` (default false for routes with no auth middleware; default `true` for routes whose middleware stack includes any class declared as `static authMiddleware = true`).
2. It is reachable via an `allow` list configured at server start (or `allow: '*'` for trusted local stdio transports).

```ts
class GetUserByToken extends AbstractMiddleware {
  static authMiddleware = true;          // ← marks this MW as auth-gating
  static get provides() { return {} as { user?: UserInstance }; }
}

await startMcpServer(app, {
  transport: 'stdio',
  allow: ['public.*'],                   // explicit allow, not regex on description
  authBridge: {                          // how MCP requests carry app credentials
    type: 'header',                      //   - header: { type: 'header', name: 'Authorization' }
    name: 'Authorization',               //   - oauth: { type: 'oauth', issuer, audience }
  },
  resourceFilter: (req, route) => {      // per-request filter (e.g. tenant scoping)
    return route.tags?.includes(req.user?.role ?? 'guest');
  },
});
```

**Per-route authz declaration.** Routes that should be reachable via MCP after auth declare it explicitly:

```ts
'/me': {
  request: ...,
  handler: this.getMe,
  mcp: { expose: true, sideEffect: 'read', requires: 'authenticated' },
}
```

`requires` values: `'public' | 'authenticated' | 'admin' | string[]` (custom roles). The framework asserts at registration time that `requires: 'authenticated'` matches a route whose middleware stack actually authenticates — mismatch fails the build.

**Mongoose `toMcpResource`** — also deny-by-default:

```ts
User.toMcpResource({
  expose: false,                                              // ← default
  // Or explicit per-method:
  read: { allow: 'authenticated', filter: (q, ctx) => ({ ...q, _id: ctx.user._id }) },
  list: { allow: 'admin' },
  redact: ['password', 'sessionTokens', 'verificationTokens'],
});
```

`filter` is mandatory for non-admin reads — it enforces row-level scoping. Without it, the resource is rejected at registration.

**Side-effect tier as a gating dimension.** The MCP client init flag `{ allowSideEffects: 'read' | 'write' | 'all' }` filters the exposed tool set. Combined with `requires`, this gives four meaningful client modes:
- `public + read` — anonymous, idempotent.
- `authenticated + read` — user-scoped reads.
- `authenticated + write` — user-scoped mutations.
- `admin + all` — admin-only destructive ops.

**What this prevents.** A developer who runs `app.toMcpServer()` without thinking gets an empty tool set (because everything defaults to hidden behind auth). They then have to opt routes in deliberately. This is the right default — opt-in to exposure, not opt-out to safety.

### 9h. Tier rollout

| Tier | Capability |
|---|---|
| **v1 (Phase 2)** | `app.toMcpServer()`, three meta-tools, typed-client export from `routes.gen.ts`, errors-as-instructions, scaffolding CLI, AGENTS.md generator, mongoose `toMcpResource`. |
| **v1.x (Phase 3)** | Tag/path filters, `responseFormat: 'concise'\|'detailed'`, token-budget guardrails (default cap 25k), code-mode bundle (`app.toCodeModeBundle()`), Vercel AI SDK adapter (`app.toAiSdkTools()`), Mastra adapter. |
| **v2+** | Auto-namespaced sub-MCP servers per Mongoose model, tool-quality lint (`framework lint:tools`), per-tool eval harness, AG-UI streaming surface for SSE/WebSocket routes. |

## 10. Edge / runtime portability

The framework's core consumes Web Fetch `Request` and produces `Response`. Adapters wrap each runtime's transport. This lands at Phase 5; Phase 1 just keeps the option open by not coupling internals to Express types beyond `ExpressAdapter`.

```
RouterAdapter (interface)
├── ExpressAdapter        ← Phase 1 (Node http via Express)
├── NodeAdapter           ← Phase 4 (Node http directly, no Express)
├── BunAdapter            ← Phase 5+ (Bun.serve)
├── DenoAdapter           ← Phase 5+ (Deno.serve)
└── WorkersAdapter        ← Phase 5+ (Cloudflare Containers / Workers)
```

The Phase 1 work that **enables this for free**:
- `Pipeline` consumes a normalized `RequestContext` built from `Request` (Web Fetch).
- Handlers return `Response` (or anything coerced to `Response`).
- Test client is `app.fetch(new Request(...))` — Hono's pattern.
- No Express types in user-facing handler signatures (Express types live behind `ctx.raw.expressReq` escape hatch only).

**Mongoose caveat.** Mongoose doesn't run on Workers. Edge support means Node-on-Cloudflare-Containers (which is fine — Containers run real Node), Bun, or Deno. Workers without Containers would need an alternative ORM (Drizzle is the natural pick — works on edge, also TS-first, also Standard-Schema-friendly). Decision deferred to Phase 5+.

## 11. Phased plan

| Phase | Scope | Tickets | Risk |
|---|---|---|---|
| **−1** *(baseline — hard prerequisite)* | Run `npm run benchmark` (and the realistic-workload variant — see §11.bench-fixtures) against current `main`. Pin numbers in `bench/baseline.json`. **Phase 0 cannot start** until this file exists and CI is configured to read it. ~½ day. | — | None |
| **0** *(type contracts — sequential prelude)* | Land the **type-only** contract surface that Phase 1a-codegen's output references: `BaseRequestContext`, `RequestContext`, `Pipeline`, `Stage`, `RouteEntry`, `RouterAdapter` (must be shaped to fit Express now and Bun/Deno/Workers later — non-trivial), `ProvidesOf`, `UnionAppInfoProvides`, `ValidationError`, `StandardSchemaV1` re-export, `AppInfoExtensions`. **No runtime code, no tests** — just types in `src/services/http/types.ts` and `src/services/validate/types.ts`. Pure additive; nothing else depends on these existing yet. ~250-300 lines. ~1 day. | — | Low |
| **1a-runtime** *(validators, no codegen)* | Standard Schema runtime; framework `ValidationError` runtime (replaces `import { ValidationError } from 'yup'` at `CustomValidator.js:1`); lib-agnostic `objectIdSchema`; `static get provides()` on `AbstractMiddleware` (typed phantom only — codegen reads it later in 1a-codegen). **Yup-import elimination from built-ins**: replace `object().shape({})` defaults at `AbstractMiddleware.ts:2,29-37` with `null`; remove yup imports from `ValidateService.js:1` and `CustomValidator.js:1`; `YupValidator` lazy-imports yup only when a yup schema is actually used. Yup `^1.0.0` → `^1.7.0` (Standard Schema requirement); moves to `peerDependenciesMeta` as optional. Add Zod likewise. **Existing tests pass unchanged** — yup still works because yup ≥1.7 is a Standard Schema. | **#9** | Med |
| **1a-codegen** *(types DX, depends on 1a-runtime)* | Codegen MVP — AST scan + per-controller `.gen.ts` + global `routes.gen.ts`. Zod 3.24 vs Zod 4 dispatch for OpenAPI introspection (3.24+ uses [`zod-to-json-schema`](https://www.npmjs.com/package/zod-to-json-schema), Zod 4 uses native `z.toJSONSchema()` — codegen detects via `package.json` resolution). `framework gen` CLI + watcher + `postinstall` hook + lefthook pre-commit hook. Migrate `Auth.ts` handlers to `req: Request<'method', '/path'>` (annotation-only — `get routes()` stays instance). `Home.ts` and `SomeController.ts` migrate in 1a-codegen-extras (or P3.5 in the small-phase split). | — | Med |
| **1b** *(controller carving, parallel)* | `RouteRegistry`, `MiddlewareParser`, `Pipeline` (flat-array stages, no per-request closures), `ValidationStage`, `ErrorBoundary`, `ExpressAdapter`, `defineMiddleware`. `HttpServer` exposes `useGlobal()` for app-level middlewares. `AppInfoExtensions` augmentation point. **`RouteRegistry` programmatic API** (`list/find/findByController`). **`RequestContext` with hidden-class-stable construction** (every field initialized in constructor). | **#12** | Med |
| **1c** *(cache drivers, parallel)* | `CacheDriver` interface, `MemoryDriver` (default), `RedisDriver` lazy-imports `@redis/client` only when constructed. `redis` → optional peer; `Cache.ts` constructor no longer hard-imports `@redis/client` at module top. Zero-TTL short-circuit. | **#13, #10** | Low |
| **1b-extras** *(rate limiter, follows 1b)* | `RateLimiter` middleware: lazy-import `rate-limiter-flexible` only when constructed; in-memory backend default; redis backend opt-in. (Cross-phase note: this lives in 1b — `RateLimiter` is HTTP middleware, not cache — but logically follows 1c's lazy-import pattern.) | — | Low |
| **2a** *(codegen + testing)* | Codegen incremental rebuild + dep graph + cache. `RequestContext` becomes public; Express types behind escape hatch. Cache `getUserByToken`. **Testing utilities** (`createTestApp`, `routeRegistry.register`, `middleware.replace`). **`OpenApiGenerator`** replaces `DocumentationGenerator.js`; `framework docs` / `docs:static` CLI. **Typed-client export** from `routes.gen.ts` (`@adaptivestone/framework/client`). | **#14** | Med |
| **2b** *(observability — full set)* | `OtelStage` + mongoose auto-instrumentation. `instrumentation-winston` for trace_id auto-injection. `/livez`, `/readyz` with check registry. `/metrics` (prom-client) with parameterized-route RED histograms. `diagnostics_channel` namespace with documented payloads. Slow-handler/query logger. Sentry adapter with isolation scope. Pyroscope hook with route auto-tag. | — | Med |
| **2c** *(perf — Express-still-default)* | Replace Express's router with `find-my-way` *behind* `ExpressAdapter` (registry binds find-my-way; Express handles transport only). Pre-compiled middleware chains. `Object.create(null)` hot-path maps. Lazy-getter `RequestContext`. `fast-json-stringify` per-route opt-in via `response` schema. Mongoose pool defaults. Benchmark gate: ≥3× current baseline. | — | Med |
| **2d** *(LLM surface)* | `app.toMcpServer({ transport })` derived from `routes.gen.ts`. Three meta-tools (`list_endpoints`, `get_endpoint_schema`, `invoke_endpoint`). Errors-as-instructions formatter. `framework add controller/middleware/field/gen/agents-md` CLI (non-interactive). Mongoose `Model.toMcpResource()`. Vercel AI SDK adapter. | — | Med |
| **3** | `NodeAdapter` (native `node:http`, no Express). `URLPatternAdapter` option. CI runs both alongside `ExpressAdapter`. Streaming response helpers (`streamSSE`, `streamJSON`). `undici` default outbound HTTP with shared Agent. Code-mode bundle (`app.toCodeModeBundle()`). | — | Low |
| **4** | Default to `NodeAdapter`. Deprecate `ExpressAdapter` (still buildable for one release). Tag/path filters in MCP server. Token-budget guardrails. | — | Low |
| **5** | Drop `express` dep. Web Fetch handler signature `(ctx) => Response` becomes canonical. `BunAdapter`, `DenoAdapter` ship. Cloudflare Containers adapter. Sub-MCP servers per Mongoose model. Tool-quality lint + eval harness. | — | Strategic |
| **side** | Mongo ER diagram. | **#11** | — |

**Phase ordering**: Phase 0 lands first (sequential prelude — half a day). Then Phase 1 tracks (1a, 1b, 1c) are independent and parallelizable. Phase 2 tracks (2a-d) depend on Phase 1b's runtime `Pipeline` + `RouteRegistry` but are independent of each other — four people can take one each.

**Phase 2c rationale.** `find-my-way` behind `ExpressAdapter` is partly throwaway: the Express integration glue gets discarded in Phase 3 when `NodeAdapter` lands. The value is hitting the perf gate and verifying the registry/pipeline contracts in production-like load **before** we change transports. If perf isn't a near-term priority, **2c can be skipped entirely** — go straight 1b → 3.

### Performance gates per phase

| Phase | Plaintext req/s, Node 24, M-series Mac | Realistic workload (mongoose query + Standard Schema validation + i18n + Sentry isolation scope) | Reference |
|---|---|---|---|
| Today (baseline) | **TBD** — must be measured first | TBD | Express + yup + winston |
| End of Phase 2c | ≥3× baseline | ≥1.5× baseline | find-my-way + flat pipeline |
| End of Phase 4 | ≥45k | ≥1× Phase 2c realistic | NodeAdapter, no Express |
| End of Phase 5 | ≥50k+ | regression-free | + `fast-json-stringify` + tuning |

**Phase −1 (above) gates this**: `bench/baseline.json` must exist before Phase 0 starts. Until those numbers exist, every gate above is unanchored.

CI runs both benchmarks (plaintext via `autocannon`, realistic via a controller fixture that hits Mongo memory-server + validates a representative request) and gates merges that regress >5% on either.

### Bench fixtures

Add `bench/fixtures/realistic.ts` — a controller that:
- Validates a 5-field request via Standard Schema (mix of required/optional/email/regex).
- Reads from a mongoose model with `mongodb-memory-server`.
- Translates an i18n key.
- Opens/closes a Sentry isolation scope (no network).

Realistic workload is the gate that actually matters; plaintext just rules out router regressions.

## 12. Migration strategy

- Repo is on `5.0.0-beta.45` — pre-release. Hard breaks are cheap; no deprecation graveyard needed.
- **3 existing controllers** to migrate: `controllers/Auth.ts`, `controllers/Home.ts`, `controllers/test/SomeController.ts`. Plus the bundled middlewares: `Auth`, `GetUserByToken`, `RateLimiter`, `Cors`, `I18n`, `IpDetector`, `PrepareAppInfo`, `RequestLogger`, `RequestParser`. Migrate `Auth.ts` first (Phase 1a) as the proof; the rest follow the same pattern.
- **`get routes()` stays an instance getter** (no static rewrite). `this.postLogin` works because instance methods live on the prototype and `this` resolves to the instance after `super()`. `AbstractController.ts:53` continues reading `const { routes } = this;` — runtime access pattern unchanged.
- **`static get middleware()` stays as `Map`** — the existing path/method-scoped shape used by `SomeController.ts:163-167` is preserved. Codegen evaluates the Map's scoping rules at build time to emit per-route flat tuples in `.gen.ts`.
- **Path overrides via `static httpPath`; `getHttpPath()` deprecated with a back-compat path.** Path overrides remain a real use case (`Home.ts:17-19` returns `/`; users override for API-version prefixes, webhook namespaces, mounting a controller at a non-class-name URL, etc.). Three rules:
  1. **`static httpPath = '/...'`** is the new canonical override. Read by both runtime (`controllers/index.ts:42-58`) and codegen (AST, no execution). Static-string only — a literal, no expressions.
  2. **`getHttpPath()` instance method is deprecated** but still honored at runtime for one release. Codegen tries to AST-evaluate it: if the method body is `return '<literal>';` (single literal-string return), the codegen extracts the literal and emits a one-time deprecation warning ("migrate to `static httpPath = '...'`"). If the body is anything dynamic (config lookup, concatenation, env vars), codegen **errors** with "dynamic `getHttpPath()` is not supported by codegen — use `static httpPath` for static overrides; if you need a runtime-computed prefix, mount the controller via `app.mount('/prefix', Controller)` instead."
  3. **No drift possible**: codegen and runtime resolve to the same value (because codegen extracts the literal that the runtime would return). The drift case the reviewer flagged (codegen sees `/auth`, runtime registers `/auth-v2`) can't happen because codegen errors if it can't extract the literal.
- Phase 5+ drops `getHttpPath()` entirely. The deprecation window is one major version.
- **Default middleware extraction.** `AbstractController.ts:7-8` hard-imports `Auth` and `GetUserByToken` for the default `static get middleware()`. Move these defaults to `src/services/http/defaultControllerMiddleware.ts` (or drop them and require user opt-in). The carved `AbstractController` has no built-in middleware — it's a clean base class, not an implicit auth gate.
- **Auth middlewares declare themselves** (required for §9g MCP `requires:` registration-time validation). Add `static authMiddleware = true` to:
  - `src/services/http/middleware/Auth.ts`
  - `src/services/http/middleware/GetUserByToken.ts`
  - any future MW that authenticates the request. Without this flag, `requires: 'authenticated'` on a route fails to validate at registration ("the route claims to require authentication but no middleware in its stack declares `static authMiddleware = true`").
- **Yup-import elimination.** `AbstractMiddleware.ts:2` imports yup `object` for empty defaults; replace with `null` (and update `relatedQueryParameters`/`relatedRequestParameters` to return `null | StandardSchemaV1`). `ValidateService.js:1` imports yup `isSchema`; remove and dispatch by `~standard` presence. `CustomValidator.js:1` imports yup's `ValidationError`; replace with framework's. `YupValidator` becomes a lazy-loaded driver — only imports yup when a yup schema is actually used. After this, **the framework runtime does not import yup at the module top-level anywhere**.
- **Redis-import elimination from default boot.** `Cache.ts` constructor today calls `getRedisClient()` eagerly. Switch to driver injection: `MemoryDriver` is the default; `RedisDriver` lazy-imports `@redis/client` only when explicitly configured. Same for `RateLimiter` middleware (currently uses `rate-limiter-flexible`'s redis backend by default).
- `package.json`: yup `^1.0.0` → `^1.7.0` (Standard Schema requirement); move to `peerDependenciesMeta` as optional. Add zod likewise. `@redis/client` and `rate-limiter-flexible` move to optional peers. No mandatory install.
- `AppInfoExtensions` ships empty; users only declare it if they have global middlewares that need typing.

### Migration order per controller

1. Run `framework gen` once — generator emits `<File>.routes.gen.ts`.
2. If the controller overrides `getHttpPath()`, replace with `static httpPath = '...'`.
3. Replace each handler's manual `req: ... & { appInfo: { request: { ... } } }` type with `req: Request<'method', '/path'>`.
4. Run `framework gen` again — `.gen.ts` files now compile (the schemas in `get routes()` are already typed via Standard Schema).
5. `tsc --noEmit` — should pass.

End state per controller: typically -10 to -50 lines (manual type duplication removed), +1 import line. Annotation-only migration. **No logic changes, no `get routes()` rewrite, no class-shape changes.**

## 13. Open questions

> Settled decisions (moved here from earlier drafts as a record):
> - **`defineRoute` ships** as the opt-in helper for inline/test routes; codegen is the primary path for declared production routes (§7b uses `defineRoute` semantics for `routeRegistry.register`).
> - **Codegen output is co-located** as `<File>.routes.gen.ts` next to source, gitignored via `**/*.gen.ts`. Plus a global `routes.gen.ts` for tooling.
> - **`AppInfoExtensions`** is the module-augmentation point for app-wide globals; per-route precision comes from the codegen artefacts.
> - **MCP authz is deny-by-default** with explicit `requires` per route and mandatory `filter` on resource reads (§9g).

1. **Schema introspection for OpenAPI** — Standard Schema doesn't expose schema shape; codegen extracts what it can via AST + per-lib introspectors (yup uses `describe()`, zod uses `z.toJSONSchema()`). Lazy-imported per `~standard.vendor`. Decision: include yup + zod introspectors in Phase 1a; valibot/others later.
2. **`defineMiddleware` helper.** Mirror of `defineRoute` for engine-neutral middleware authoring. Useful in Phase 1b but could land in Phase 2. Decision: ship in 1b alongside the Pipeline so the Pipeline's stage type is the canonical middleware shape from day one.
3. **Multipart strategy for Phase 3.** `formidable` is Express-coupled. Options: swap to `busboy` (cleaner, transport-neutral) or keep formidable behind the adapter (less change, more glue). Decision: defer; investigate during Phase 3.
4. **Generator parser.** TS compiler API (slower, official, exact) vs. `oxc-parser` (much faster, Rust). Decision: start with TS compiler API for correctness; benchmark and consider `oxc` if generator latency becomes a dev-experience issue.
5. **Test-app fetch shape.** `app.fetch('POST', '/path', { body, headers })` (custom) vs. `app.fetch(new Request(...))` (Web Fetch). Decision: ship the Web Fetch signature even in Phase 2 — it's the same surface that becomes universal in Phase 5, and tests written today won't have to change.
6. **Span attribute conventions.** Use `@opentelemetry/semantic-conventions` for HTTP (current stable: `http.request.method`, `http.route`, `url.path`, `http.response.status_code`) and DB (`db.system`, `db.statement`). Custom `app.*` attributes for handler-specific enrichment. Decision: follow current OTel HTTP semconv; track the semconv repo for renames.
7. **Mongoose OTel — auto vs. manual instrumentation.** `@opentelemetry/instrumentation-mongoose` auto-instruments globally; alternative is per-model wrapping. Decision: auto-instrumentation, opt-out per model only if needed.
8. **Router for Phase 2c.** find-my-way (proven, Fastify uses it, no caveats) vs. building our own SmartRouter from day one. Decision: ship find-my-way in Phase 2c — the simpler win — and keep SmartRouter (Hono-style) as a Phase 5+ optimization once we have benchmarks showing find-my-way is the bottleneck.
9. **`fast-json-stringify` opt-in vs. opt-out.** Opt-in via per-route `response` schema is safer (no surprises with edge-case payloads); opt-out (compile by default whenever a `response` exists) gives users the fast path automatically. Decision: opt-in with a clear warning in the doc — automatic compilation is a footgun on schemas with `additionalProperties` or large nested unions.
10. **MCP transport default.** `stdio` (local-only, simpler) vs. `http` (network, broader). Decision: support both; default `stdio` for `framework mcp serve` CLI, but expose `http` mount as `app.use('/mcp', mcpHttpHandler)` for in-process exposure.
11. **Code-mode bundle vs. typed client.** Anthropic's pattern emits per-tool `.ts` files; Cloudflare's emits an RPC bundle. Decision: ship both behind `app.toCodeModeBundle({ shape: 'files' | 'rpc' })`; default `'rpc'` (single import, simpler) but produce `'files'` when the route count exceeds N (configurable).
12. **Edge story when mongoose can't run.** Cloudflare Containers (real Node, mongoose works) vs. Drizzle as a sibling ORM for true Workers/edge. Decision: Phase 5+; defer until we have actual user demand. Containers are the safer first stop.
13. **Diagnostics_channel ownership.** Should published events be a public API (semver-stable) or internal (subject to change)? Decision: public. APM vendors and user observability code depend on stable shapes. Document in `docs/diagnostics-channels.md`; treat changes as breaking.

## 14. Reference points

> **Note:** local research clones live at `~/Work/framework-ideas/{hono,router}` (outside this repo). The line numbers below were captured against those clones' state at the time of writing — pin to the GitHub permalinks before the plan is shared, since upstream files move.

- **Hono** — [`honojs/hono`](https://github.com/honojs/hono). Files of interest (paths relative to repo root): `src/types.ts` (chainable type accumulation), `src/validator/validator.ts` (validator middleware), `src/context.ts` (Variables augmentation, lazy getters), `src/helper/factory/index.ts` (createHandlers separated), `src/router/smart-router/router.ts` (lazy build + rebind), `src/router/reg-exp-router/router.ts` (single-regex compile), `src/compose.ts` (recursive middleware dispatch), `src/utils/stream.ts` (Web Streams + onAbort). Read for: validator output → handler input via `Input` generics; `Env['Variables']` augmentation; production-grade router/composer/streaming techniques.
- **TanStack Router** — [`TanStack/router`](https://github.com/TanStack/router). Files of interest: `packages/router-plugin/src/vite.ts` (file watcher), `packages/router-generator/src/generator.ts` (codegen entry), `packages/react-router/src/fileRoute.ts` (`createFileRoute` literal-string-constrained signature), example `routeTree.gen.ts` outputs under `examples/`. Read for: AST-based codegen, module-augmentation as user-side API, per-file route convention.
- **Mongoose pattern in this repo** — `BaseModel.ts:18-22` (`ExtractProperty`), `:25-79` (`GetModelTypeFromClass`), `User.ts:33-76` (`static get modelSchema()` with `as const`). The codegen Request types reuse `ExtractProperty` directly.
- **Hono routing internals** ([`honojs/hono`](https://github.com/honojs/hono)) — `src/router/smart-router/router.ts` (lazy build + rebind pattern), `src/router/reg-exp-router/router.ts` (single-regex compile via Trie), `src/compose.ts` (recursive middleware dispatch with closure-captured index, no allocation), `src/context.ts` (lazy getters: `c.req`/`c.var`/`c.res` not allocated until accessed; `Object.create(null)` for hot-path objects), `src/utils/stream.ts` (Web Streams wrapper with `onAbort()` pattern), `src/hono-base.ts` (`app.request()` in-process test client). For: production-grade techniques to either steal or adapt for Node.
- **Fastify v5** — [official benchmarks](https://fastify.dev/benchmarks/) (Jan 2026: Fastify 46,664 vs Hono 36,694 vs Express 9,433 req/s). Pre-compiled handler chains, find-my-way router, fast-json-stringify integration, lifecycle hooks. Reference for what "Express replacement on Node" looks like in production.
- **Encore.ts** — [Rust runtime architecture](https://encore.dev/blog/rust-runtime), [9× Express benchmark](https://encore.dev/blog/event-loops). Demonstrates that you can keep TS DX while pushing perf-critical paths to native — relevant if Phase 5+ ever justifies it.
- **Standard Schema 1.0** — [standardschema.dev](https://standardschema.dev/). Implemented by Zod 3.23+/v4, Valibot 1+, ArkType, Effect Schema, TypeBox. The `~standard.validate(input)` interface is the contract; `~standard.types.output` is how we read inferred output types. Adopted by tRPC, TanStack, Hono. Foundation for the validator phase.
- **OpenTelemetry HTTP semconv** — [http-spans](https://opentelemetry.io/docs/specs/semconv/http/http-spans/), [http-metrics](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/). `http.route` MUST be parameterized; MUST NOT be set if framework can't supply it. Drives the metrics/spans label conventions.
- **Sentry + OTel** — [Sentry's OTel platform docs](https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry/). Sentry Node SDK is now built on OTel — every framework-emitted span is automatically picked up; per-request `Sentry.withIsolationScope()` is the canonical pattern.
- **MCP TypeScript SDK** — [official repo](https://github.com/modelcontextprotocol/typescript-sdk), [docs](https://ts.sdk.modelcontextprotocol.io/). Tools registered via `server.registerTool(name, { description, inputSchema }, handler)`; accepts any Standard Schema. Streamable HTTP transport (2025-03-26 spec).
- **Anthropic — Code Execution with MCP** — [engineering post](https://www.anthropic.com/engineering/code-execution-with-mcp). 98.7% token reduction (150k → 2k) by exposing tools as a TypeScript module surface for "progressive disclosure" — the agent reads only what it needs. Foundation of the typed-client export pattern.
- **Anthropic — Writing tools for agents** — [engineering post](https://www.anthropic.com/engineering/writing-tools-for-agents). Namespacing rules, response_format conventions, error-as-instruction pattern, response size caps (default 25k tokens).
- **Cloudflare — Code Mode** — [blog post](https://blog.cloudflare.com/code-mode/). LLM-generated TypeScript executed in V8 isolates against framework RPC bindings. Reference for `app.toCodeModeBundle()`.
- **Stainless — OpenAPI to MCP lessons** — [blog post](https://www.stainless.com/blog/lessons-from-openapi-to-mcp-server-conversion). The 40-tool ceiling, Cursor's cap, accuracy degrades up to 85%. The three-meta-tool pattern (`list_endpoints`, `get_endpoint_schema`, `invoke_endpoint`) — the canonical workaround.
- **`mcp-it/fastify`** — [repo](https://github.com/AdirAmsalem/mcp-it). Closest precedent for "framework auto-discovers routes → MCP tools." Per-route `config.mcp: { name, description, hidden }` override pattern.
- **AGENTS.md spec** — [agents.md](https://agents.md/). Linux Foundation standard, supported by Claude Code/Cursor/Codex/Copilot/Windsurf. Anecdotal reports suggest verbose AGENTS.md files can reduce agent success rates and add inference cost (verify before citing in user-facing docs); the conservative posture — keep ours minimal and factual — stands regardless.
- **Node `diagnostics_channel`** — [Node docs](https://nodejs.org/api/diagnostics_channel.html). Stable since v18.13. Zero cost when no subscribers attached. The right tool for framework-owned extension hooks; APM vendors already consume similar Node-native channels.
- **`@opentelemetry/instrumentation-winston`** — [npm](https://www.npmjs.com/package/@opentelemetry/instrumentation-winston). Auto-injects `trace_id`/`span_id`/`trace_flags` into winston records. Optionally bridges winston → OTel Logs SDK via `@opentelemetry/winston-transport`.
- **prom-client + cardinality** — [repo](https://github.com/siimon/prom-client), [Games24x7 P99 10× writeup](https://medium.com/@Games24x7Tech/optimizing-prom-client-how-we-improved-p99-latencies-by-10x-in-node-js-c3c2f6c68297). Standard Prometheus exporter; cardinality is the #1 risk — strict label discipline (`method`, `route`, `status_code` only).
- **Pyroscope (Grafana)** — [`@grafana/pyroscope-nodejs`](https://github.com/grafana/pyroscope-nodejs), [docs](https://grafana.com/docs/pyroscope/latest/configure-client/language-sdks/nodejs/). pprof export, dynamic tag injection — the route-auto-tag hook is the killer feature.
- **find-my-way** — [repo](https://github.com/delvedor/find-my-way). Fastify's radix-tree router. Proven, no syntax limitations. The pragmatic choice for Phase 2c.
- **`fast-json-stringify`** — [repo](https://github.com/fastify/fast-json-stringify). Schema-compiled JSON serialization; ~2.4× small strings, ~1.6× small objects. Watch out for `additionalProperties` / large unions. Per-route opt-in.
- **`undici`** — [Matteo Collina deep dive](https://gitnation.com/contents/deep-dive-into-undici). Direct `undici.request` + shared `Agent` is ~3× faster than `fetch`/`axios`/`got` for high-throughput cases.
