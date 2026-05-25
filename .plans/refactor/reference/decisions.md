# Settled decisions

These were debated and settled. Don't relitigate without proposing an amendment with new information.

## Architecture

- **Standard Schema** ([standardschema.dev](https://standardschema.dev/)) is the validator interface. Yup ≥1.7 and Zod ≥3.24 already implement it. Zero glue needed.
- **`get routes()` stays as an instance getter.** Static getters break `handler: this.method` (instance methods live on the prototype; `static this.foo` is `undefined`). `AbstractController.ts:53` continues reading `const { routes } = this;`.
- **`static get middleware()` stays as `Map<string, TMiddleware>`.** The path/method-scoped Map (used by `SomeController.ts:163-167` with parameterized middleware tuples) is preserved. Codegen evaluates the Map's scoping rules at build time to emit per-route flat tuples in `.gen.d.ts`.
- **Codegen is the primary path; `defineRoute` is opt-in.** `defineRoute` ships for inline/test routes (`routeRegistry.register` uses its semantics).
- **Codegen output is co-located** as `<File>.routes.gen.d.ts` next to source, gitignored via `**/*.routes.gen.d.ts`. Plus a global `routes.gen.d.ts` for tooling. `.d.ts` chosen over `.ts` so tsc doesn't produce empty `.js` artifacts in `dist/` (gen files are pure types — type aliases only).
- **`AppInfoExtensions`** is the module-augmentation point for app-wide globals; per-route precision comes from the codegen artefacts.
- **MCP authz is deny-by-default.** Routes with `static authMiddleware = true` middlewares hidden by default; explicit `requires` per route asserted at registration; `Model.toMcpResource({ expose: false })` default; mandatory `filter` for non-admin reads.
- **`Pipeline` + `RouterAdapter`** is the engine-neutral seam. Phase 1b ships `ExpressAdapter` only; later phases add `NodeAdapter`, `BunAdapter`, `DenoAdapter`, `WorkersAdapter`. Internal request shape is **Web Fetch standard** (`Request`/`Response`).
- **`find-my-way`** as the router for Phase 2c (proven, Fastify uses it). Hono-style `SmartRouter` (single compiled regex, O(1)) is a Phase 5+ option only if benchmarks show find-my-way is the bottleneck.
- **Pre-compiled middleware chains.** `RouteRegistry` flattens [global stages] + [controller MWs] + [route MWs] + [validation] + [handler] into a single array at registration; `Pipeline.dispatch` walks it index-by-index. No per-request closure allocation.
- **Hidden-class-stable `RequestContext`.** Every field initialized in the constructor (the single biggest "free" V8 perf win). Lazy getters for expensive resources (`ctx.req`, `ctx.cookies`, `ctx.var`).
- **Observability on by default** (Phase 2b). All optional peers; no overhead when not installed.
- **MCP-first agent surface** (Phase 2d). `app.toMcpServer()` derives tools from the `RouteRegistry` (and the per-controller `*.routes.gen.d.ts` artefacts). Three meta-tools handle the >40-tool ceiling. Typed-TS client export from the same registry walk.
- **URL prefixes via `getHttpPath()`** — default returns `/{constructor-name-lowercased}`; override in subclasses for custom paths (e.g., `Home` → `/`). Codegen reads the value via runtime introspection on the controller instance — no separate `static httpPath` field needed. `app.mount(prefix, Controller)` registers a controller with a runtime-computed prefix.

## Validator architecture (P1a-runtime)

- **Validators serve three concerns and the design splits responsibility cleanly between the schema and the driver.** Conflating them caused the architectural confusion in earlier iterations of this plan.

  | Concern | Lives on | API |
  |---|---|---|
  | Runtime validation + cast | Driver | `driver.validate(body, data) → Promise<unknown>` (throws `ValidationError`) |
  | Compile-time TypeScript types for handlers | Schema (Standard Schema spec) | `StandardSchemaV1.InferOutput<typeof schema>` |
  | JSON Schema for OpenAPI export | Driver | `driver.toJsonSchema?(body) → unknown \| null` |

  Types live on the **schema** because Standard Schema's `~standard.types.output` slot is the canonical TypeScript bridge — every conformant lib (yup ≥1.7, zod, valibot, arktype) populates it. JSON Schema lives on the **driver** because export logic is genuinely per-vendor (zod v4 has native `z.toJSONSchema()`; yup needs hand-rolled mapping from `schema.describe()`; valibot uses `@valibot/to-json-schema`). The driver is the right vendor-aware adapter.

- **Standard Schema is the canonical validation interface.** Verified empirically: yup ≥1.7, zod v4, valibot, arktype all populate `~standard` correctly. zod v4's `~standard.validate` strips unknowns by default, returning the cast value — the `standardSchemaDriver` calls it directly with no post-process. **Yup is the lone outlier**: yup's `~standard.validate` does NOT strip, so the `yupDriver` calls yup's native `body.validate(data, { stripUnknown: true, abortEarly: false })` instead — one call, validates+casts+strips, throws yup's `ValidationError` which the driver duck-type-translates to the framework's `ValidationError` (no top-level yup import needed in the framework).

- **Two built-in functional drivers**, plain objects implementing `ValidatorDriver`:
  - `yupDriver` — handles `body['~standard'].vendor === 'yup'`. Calls yup's native validate with `stripUnknown: true`. `toJsonSchema` filled in by P2a.
  - `standardSchemaDriver` — handles any other `body['~standard']` (zod, valibot, arktype, custom user-implemented SS). `toJsonSchema` returns null (vendor-specific drivers register later for OpenAPI).

  **Resolution order: yup → standardSchema** (yup is more specific). User-registered drivers prepend by default via `ValidateService.register(driver)`. Schemas that match no driver throw at construction with a migration message.

- **Legacy `{validate, cast}` plain-object schemas removed.** Audit of 4 production codebases (~100 schemas) found zero usages. The legacy section in `framework-documenation-github/docs/06-Controllers/02-routes.md` was already replaced with the Standard Schema validation guide. At `5.0.0-beta.45`, hard breaks are cheap. Bonus: users wrapping as Standard Schema get free TypeScript types via `InferOutput`.

- **Drop `req:` context in validators.** Audit of 4 production codebases (tht-server 44 schemas, xtok 46 schemas, insailing 8 schemas, framework-example 0) found **zero** uses of `req` / `req.query` / `req.body` / `req.appInfo` inside `.test()` or `.when()` callbacks. The framework docs do not document `req:` context as a feature. Cross-field validation in user code lives within the schema's own data tree (yup's `this.parent`, zod's `.refine`); auth-aware logic belongs in the handler, not the schema.

- **Preserve yup `stripUnknown` behavior.** Same audit found 8 sites in tht-server (Kanban.js + Container.js) that spread `req.appInfo.request` into `Model.create(...)` — losing implicit strip would be a security regression. The yupDriver always strips (matches today). Users who genuinely want unknowns: switch to zod with `.passthrough()`, valibot's `looseObject`, or register a custom driver.

- **Validation collapses to one method.** Today's `validateFields()` + `castFields()` two-step (yup-specific) collapses into a single `driver.validate(body, data) → cast value | throw`. Standard Schema's `validate(data)` already returns `{value}` on success — value IS the cast/parsed/transformed output. The two-step model was a yup quirk that didn't generalize.

- **User extension paths**:
  - **Standard Schema-conformant validators**: implement the `~standard` shape (~10 lines for a custom shim), get validation + types automatically. `standardSchemaDriver` handles them.
  - **Custom non-SS lib (e.g., raw Joi)**: register a custom driver via `ValidateService.register(driver)`. For TypeScript types, **wrap as Standard Schema** — there is **one type-extraction pipeline** (`StandardSchemaV1.InferOutput`). Drivers cover validation + OpenAPI; types come from the schema's `~standard.types.output`.
  - **AppInfoExtensions module augmentation**: users add globally-typed `appInfo` fields via `declare module '@adaptivestone/framework' { interface AppInfoExtensions { ... } }`. Empty interface exposed from the framework's types entry, populated per-app.

## Codegen architecture (P1a-codegen, resolved)

- **Runtime introspection over AST scanning.** Original plan (carried over from TanStack Router) was a TS-compiler-API AST scanner. We chose to boot the framework with `isSkipModelInit: true` + a fake `httpServer = { express: parentApp }`, walk `cm.controllers` directly. Reasons: (1) Express compiles paths and methods at controller construction — re-implementing that for the AST scanner is duplicate work; (2) ~250 lines of helpers vs. ~500-line scanner; (3) cross-controller middleware composition (parent `/admin` middleware applying to nested `/admin/users/foo`) becomes "Express handles it at runtime" instead of "we re-implement Express's mount-and-fall-through dispatch in codegen." Trade-off: ~80ms boot per invocation vs. ~50ms AST parse per controller. Acceptable for `check:types`/CI; if dev-loop pain shows up later, an AST fast-path is an additive optimization. (Resolves open question #3.)

- **Folded into the existing `GenerateTypes` command, not a standalone CLI binary.** One framework command emits both `genTypes.d.ts` (app-level config + model maps) and per-controller `<File>.routes.gen.d.ts` (route-level handler types). Same `isShouldInitModels = false` lifecycle. Standalone `framework gen` CLI binary (with `bin` entry) was specced but never shipped — the per-command pattern works fine with `npm run cli generatetypes`.

- **Handler-method-named types, not `Request<verb, path>`.** Codegen emits `<MethodName>Request` aliases (e.g., `PostLoginRequest`). Renames in the route definition (POST→GET, path change) don't churn handler signatures; only renaming the handler method itself changes the type name (and the editor's rename refactor handles that automatically). Tested and rejected `Request<'post', '/login'>` form — required two literal updates on every method change.

- **`implements AuthHandlers` doesn't work for class methods in TS.** Tested empirically: TypeScript does not propagate contextual types from `implements` clauses to class method parameters (errors with TS7006 "Parameter X implicitly has an 'any' type"). Confirmed via long-standing TS issues. Class-field arrow methods (`postLogin: AuthHandlers['postLogin'] = async (req, res) => {...}`) DO get contextual typing, but BREAK at runtime in the framework's current architecture: `AbstractController`'s constructor walks `this.routes` immediately after `super()`, before the subclass's class fields initialize, so `handler: this.postLogin` captures `undefined`. Both options become viable after P1b moves route walking out of the constructor; until then, explicit `req: PostLoginRequest` annotation is the right choice.

- **Schemas stay inline in `routes` getter, no extracted exports needed.** Codegen uses `InstanceType<typeof Controller>['routes']['<verb>']['<path>']['request']` type navigation to reach inline schemas. TS preserves literal keys through the navigation, and `StandardSchemaV1.InferOutput<...>` extracts the cast output type. No `as const`, no extracted named consts.

## Codegen behavior (P1a-codegen, resolved)

- **`BaseAppInfo.i18n` required, not optional.** `I18nMiddleware` is in `HttpServer`'s default chain (`HttpServer.ts:63`) and runs on every HTTP request before any controller. Handlers can rely on it. Users who remove I18n from their global chain augment `BaseAppInfo` to relax. Avoids `req.appInfo.i18n!` non-null assertions all over user code.

- **Gen files gitignored, regenerate via `check:types`.** Pattern: `**/*.routes.gen.d.ts` ignored; `package.json`'s `check:types` is `"npm run gen && tsc --noEmit"`. Cold-start works on fresh clones without postinstall: `npm install && npm run check:types` regenerates before tsc runs. Fresh clones have a brief window of red squiggles in IDE until first regen completes; postinstall (deferred) closes that window.

- **Auto-loader filters `*.gen.{ts,js}` alongside `*.test.*` and `*.d.ts`.** Found via test failure: gen files in `src/controllers/` were being picked up as controllers (their `default` export is `undefined` since they're type-only). Filter lives in `src/helpers/files.ts:notTests` (slightly misnamed since it now filters more than tests, but the API is internal).

## Routing architecture (P1b, resolved)

- **Single-mount Express integration.** The framework calls `app.express.use(adapter)` exactly once. The adapter delegates path matching, method dispatch, parameter extraction, and middleware execution to our `RouteRegistry`. Express keeps HTTP lifecycle (`app.listen`), body parsing, the third-party middleware ecosystem (`cors`, `helmet`, `compression`), and the response API (`res.json`, `res.status`). It stops being a router. Trade-off: ~50 lines of matcher in our code. Gains: `http.route` populated directly from the registry (no regex reverse-engineering for OTel); middleware spans named from `MiddlewareEntry.Class.name`; engine-neutral dispatch (Express adapter is ~30 lines, swappable to Hono/Fastify/native by re-implementing req/res shape conversion); future find-my-way swap-in is a `match()` replacement, not an adapter rewrite.

- **One global `RouteRegistry`, not per-controller.** Controllers contribute *subtrees* to a single registry rooted at the app. `ControllerManager` owns the translation (private method) — reads `get routes()` + `static middleware()` Map, builds a `RouteNode` subtree, mounts via `registerSubtree(prefix, node)`. Cross-controller middleware composition (parent `/admin` middleware applying to nested `/admin/users/foo`) is a tree-walk semantic, not Express mount-and-fall-through. Resolves OQ #13.

- **Tree-based `RouteNode` shape.** Each node carries `{ segment, middlewares, methods, children, paramChild?, splatChild?, meta }`. Walk semantics: enter node → run its middlewares → descend. Specificity ordering is structural — separate `paramChild` and `splatChild` slots, plus the static `children` map. Static segments win, then param, then splat. Encoded by structure, not regex priority.

- **Registry observable; matcher derived.** Registry stays as a tree of plain objects (cheap to walk for codegen, OpenAPI emit, MCP, OTel). Matcher is a derived structure: simple tree-walk in P1b (~50 lines), find-my-way in P2c (drop-in replacement with the same `match()` signature). One source of truth; multiple consumers.

- **Backward-compat translation IS the authoring path; no new shape planned.** Existing `get routes()` + `static get middleware()` Map are translated to subtrees at registration time by `ControllerManager` (private method, not a separate file or class method). Existing controllers don't change in v5 or v6. The tree-based registry is a runtime/observability upgrade — users keep writing `get routes()`. Power users who need hierarchical subtree composition (e.g., "all routes under /admin get this middleware") use `app.routeRegistry.registerSubtree(prefix, subtree)` from the boot hook. Considered and rejected for v6: a new `get routeTree()` authoring shape — translation already covers all real use cases, migration cost across controller-heavy codebases outweighs the marginal ergonomic gain.

- **`AbstractController` becomes data-only.** Constructor holds `app` + `prefix`. Subclasses override `get routes()` / `static get middleware`. No `express.Router()`, no `this.router`, no per-controller mount. Global boot does the wiring. Shrinks from 461 lines to ~50.

- **405 Method Not Allowed when path matches but method doesn't.** When the matcher finds a node with handlers but the request's method isn't in `node.methods`, return 405 with an `Allow` header listing the available methods. HTTP-spec-compliant; helps API consumers debug. Today's framework returns 404 in this case (Express default); the v5 break is small, additive, and more correct. Opt-out flag `app.config.http.strict405 = false` falls back to 404 for back-compat.

- **Middleware insertion via `position` (extended).** `useGlobal(MW, { position })` accepts: named anchors `'before-builtins' | 'after-builtins' | 'before-controllers'` (already documented), plus relative anchors `{ before: 'MwClassName' } | { after: 'MwClassName' }` and shorthand `'first' | 'last'`. Plugin-friendly without overengineering. Within a controller's middleware array, order is array order (no special API — explicit is better here). **Timing constraint**: `useGlobal` must be called during app boot, before `initControllers` runs (i.e., before any controller binds via the boot hook). Calls after that point throw `ConfigError("useGlobal called after controllers were initialized")` — validated via a flag set when `initControllers` starts.

## Path syntax compatibility (v5, resolved)

- **Express-5-style syntax subset, validated against production.** The matcher supports literal segments, single-segment `:name` parameters, and `*name` splats. Splats in user code can be written as `*name` or as `{*name}` (translator converts). **Production validation**: 240 routes audited across reference projects — every pattern uses only literal + `:name` + `{*splat}` (in middleware Map keys). Zero usage of optional segments, multi-param-per-segment, regex constraints, or path arrays.

- **Unsupported syntax** (translator throws with migration hint when it sees these in user code):
  - `{:name}` optional segments → register optional and required forms as separate routes
  - `:name?` legacy optional parameters → same fix
  - `:id(\\d+)` regex constraints → validate inside the handler instead
  - `:from-:to` multi-param-per-segment → split into separate segments

  None of these patterns occurred in the 240-route production audit. Direct callers of `registerRoute` (ad-hoc routes in `bootHttp`) get raw matcher behavior — those callers are devs writing internal paths and don't need defensive validation.

- **No future migration planned.** The matcher's `:name` / `*name` is a permanent v5+ contract. `find-my-way` swap (P2c) and `URLPattern` (v6+ portable runtimes) are listed in `prior-art.md` for reference only — optional alternatives, not planned migrations. Current matcher beats the prior router by ~2.3× on microbenchmarks (`benchmark/router-comparison.ts`) and supports 100% of production patterns.

## Routing semantics (v5, resolved)

Cross-ecosystem research (13 frameworks across 8 languages) confirmed Express's defaults for the v5 contract. Documentation: research output preserved in `_archive/routing-semantics-research-2026-05-09.md` (frameworks compared: Express 5, Fastify 5, Hono, Koa, Laravel, Symfony, Rails, Sinatra, Django, FastAPI, Spring Boot, Actix Web, Axum, ASP.NET Core, Gin, Echo, Chi).

- **Trailing slash: lenient default in v5.** `/users` and `/users/` match the same handler. Matches Express 5's `strict: false`. Per-controller override `static strictTrailingSlash = true`; app-wide default in `app.config.http.strictTrailingSlash`. Flipped to strict-default in v6 (modern majority — Fastify, Spring 6+, Hono, Chi all default strict). Optional auto-redirect-to-canonical middleware ships separately for users who want Symfony/Django-style 301s.

- **Case sensitivity: insensitive default in v5.** `/Users` matches `/users`. Matches Express 5's `caseSensitive: false`. Per-controller override `static caseSensitive = true`; app-wide default in `app.config.http.caseSensitive`. Flipped to sensitive-default in v6 (modern consensus — RFC 3986 says paths are case-sensitive; Express, Koa, ASP.NET Core are outliers).

- **URL decoding: per-segment, not whole-path.** Internal matcher rule (no user config): split `req.url` pathname on `/` (using the encoded form), then `decodeURIComponent` each segment, then match. Result: a request to `/users/foo%2Fbar` matches `/users/:name` with `name = 'foo/bar'` (intuitive). Express's whole-path `decodeURIComponent` decodes `%2F` to `/` BEFORE matching, which can route `/users/foo%2Fbar` as `/users/foo/bar` and miss the intended route — a known footgun. The per-segment model (Spring's `PathPatternParser`) is one of the few places we deliberately deviate from Express in v5 because the change is invisible to apps that don't use encoded slashes and meaningfully safer for those that do. Malformed encodings (e.g., lone `%`) throw `URIError` from `decodeURIComponent`; matcher catches and returns 400 Bad Request. **No user-facing toggle** — this is the right model and stays the same in v6.

## Project entry point + webhook support (P1b, resolved)

- **Project boot hook at `src/controllers/index.ts`.** If the file exists, the framework imports it and calls its default export `async function bootHttp(app: IApp)` after the registry is initialized but before the Express adapter mounts. The hook is the user's seam to: register global middleware via `app.useGlobal(...)`; opt into auto-load via `app.controllerManager.loadAll()`; register controllers programmatically; register ad-hoc routes; override defaults. Without the file, the framework synthesizes a default `bootHttp(app) => app.controllerManager.loadAll()` — back-compat with today's behavior. Path resolved via `folderConfig`; auto-load is no longer the only entry point but stays the default.

- **Match-then-walk dispatch.** The Express adapter runs matching FIRST (cheap tree walk, populates `req.routeMeta = matchResult.entry` and `req.params`), THEN walks the accumulated middleware chain. This is what lets globally-registered middleware (`RequestParser`, `ValidationStage`, OTel `OtelStage`) read `req.routeMeta` and adapt per-route. Without it, a global `BodyParser` would consume the request stream before the route's preferences are known. This pattern also gives `http.route` to OTel without regex reverse-engineering.

- **Per-route `bodyParsing: 'parsed' | 'raw' | 'none'`.** Routes opt out of parsing for raw-body scenarios (Stripe webhook signature verification, streaming uploads, custom binary protocols). `RequestParser` reads `req.routeMeta.bodyParsing`: `'parsed'` (default) dispatches by Content-Type to the parser registry (json/multipart/urlencoded); `'raw'` captures the request stream into `req.rawBody: Buffer` and skips parsing; `'none'` leaves the request untouched. Settable on `RouteNode` (inherits down the subtree, leaf-wins) and on `HandlerEntry` (leaf only). Default `'parsed'` preserves today's behavior in v5. Resolves the xtok-style monkey-patch problem (xtok's `server.ts:11-33` patched `RequestParserMiddleware.prototype.middleware` to capture raw bytes for `/stripe/webhook` — that hack goes away).

- **Ad-hoc route registration via `app.routeRegistry.registerRoute(method, path, entry)`.** Escape hatch for routes that don't fit the controller convention (webhooks, healthchecks, OAuth callbacks). Same `HandlerEntry` shape `ControllerManager`'s translation produces — supports `bodyParsing`, route-level middleware, etc. Available inside `bootHttp`. Live runtime additions (after boot) are supported but discouraged — registry rebuild is fast enough that re-runs are preferred over partial mutations.

- **File uploads (`YupFile` + multipart) preserved under default `bodyParsing: 'parsed'`.** `RequestParser` is content-type-aware: `multipart/form-data` → formidable, `application/json` → JSON parse, `application/x-www-form-urlencoded` → urlencoded parse. The route declares only `'parsed' | 'raw' | 'none'`; the parser dispatches by Content-Type internally. `bodyParsing: 'raw'` and `'parsed'` are mutually exclusive — raw mode bypasses parsing entirely, so file-upload routes must keep `'parsed'`. Engine-neutral multipart (busboy or web-standard `File` API) is deferred to P3 (OQ #2); when it lands, the `parseMultipart` function in `RequestParser.ts` and the `File` alias in `services/http/files.ts` change in lockstep — user code is untouched.

- **Lenient Content-Type acceptance in v5; strict default deferred to v6.** Per the v5 migration philosophy (keep user-visible behavior close to today's), `bodyParsing: 'parsed'` retains formidable's lenient behavior — multipart, urlencoded, and json are first-class; unknown Content-Types fall through to formidable's text/buffer fallback. v6 flips the default to strict: 415 for any Content-Type not in the parser registry. The strict-vs-lenient choice is a single config flag (`app.config.http.strictContentType`); v5 default `false`, v6 default `true`. Built-in Content-Type handlers (json, multipart, urlencoded) come from the parser registry; in v5 the formidable-lenient fallback also runs for unknowns.

- **Pluggable parser registry (v5 inclusion).** `app.parsers.register(contentType, parser)` lets users add first-class support for custom Content-Types (protobuf, CBOR, msgpack, etc.) without dropping to `bodyParsing: 'raw'`. `RequestParser` consults the registry when `bodyParsing: 'parsed'` and the Content-Type matches a registered handler. Built-ins seeded at boot — replaceable but not deletable (json/multipart/urlencoded). User-registered parsers compose with the default; no monkey-patching. Originally proposed as P1b-extras; promoted to v5 inclusion to reduce the surface area of `'raw'` opt-outs and to match the Fastify `addContentTypeParser` model.

- **Runtime warning for body-dependent middleware on `'raw'` / `'none'` routes.** Detection via `req.body == null` access from inside an Express-shape middleware. Logged once per route (deduped) at warn level: `"middleware MwName accessed req.body on a route with bodyParsing: '<mode>' — use req.rawBody or change the route's mode."` Optional stricter mode: throw instead of warn (gated by `app.config.http.strictBodyAccess = true`). Helps catch the common gotcha (middleware that worked on JSON routes silently breaking on raw routes) without forcing introspection on the validator interface.

- **Multipart parser is always-array; scalar coercion happens schema-side via `multipartScalar` helper.** Formidable v3+ wraps every multipart field in `T[]`; the parser preserves that shape (no introspection, no normalization, no parser-validator coupling). Schemas declare what they want. For fields with cardinality `0..N` (one-or-more values from a single form field), `yup.array(yup.string())` works directly because the parser always produces arrays. For inherently scalar fields, `multipartScalar(inner)` (in `src/helpers/multipart.ts`) wraps a Standard Schema validator with auto-unwrap of single-element arrays — vendor-neutral, ~15 lines, works with yup/zod/valibot/arktype/custom-Standard-Schema. Examples: `email: multipartScalar(yup.string().required())`, `tags: yup.array(yup.string())`, `avatar: multipartScalar(new YupFile())`, `avatars: yup.array(new YupFile())`. This flips `YupFile.check` from "array of `PersistentFile`" to "single `PersistentFile`" (matches the wrapping idiom). Considered and rejected: per-driver `getFieldShape` introspection (B) — added a hidden dimension to the validator interface that users couldn't see in their own code. Codegen path is unaffected: types come from `StandardSchemaV1.InferOutput`, which reads the schema, not the parser output.

- **Standard-Schema-only file validation via framework-exported `File` type.** When users pick zod/valibot/arktype, they validate files via their validator's idiomatic `instanceof` checker against `File` exported from `@adaptivestone/framework/types` (today aliases `PersistentFile`, P3 swap aliases web-standard `File`). Examples: Zod `z.instanceof(File)`, Valibot `v.instance(File)`, ArkType `type.instanceOf(File)`. `YupFile` keeps its yup-specific class API for users who pick yup. No new framework-defined "file schema" abstraction is shipped — each validator's idiom is enough. A vendor-neutral `fileSchema()` helper is a P1b-extras candidate if the per-validator idioms turn out to be confusing.

## Schema introspection for OpenAPI (resolved)

- **Standard Schema does not include JSON Schema export.** Per-vendor adapters live on the driver's optional `toJsonSchema(body)` method. Drivers stub `null` in P1a-runtime; P2a fills in built-ins (zod via native `z.toJSONSchema()`; yup hand-rolled from `schema.describe()`; valibot via `@valibot/to-json-schema` peer; ArkType via `.toJsonSchema()` method). Lazy-load lib-specific deps inside `toJsonSchema`. (Resolves open question #1.)

## Deferred to v6

These are settled-in-direction but explicitly NOT shipping in v5 — preserving v5's "stay close to today's behavior" promise.

- **`next()` semantics replaced with awaitable middleware.** Today's `(req, res, next) => void` Express signature stays in v5 behind the adapter. v6 introduces `(ctx) => Response | Promise<Response>` (or similar) as the canonical middleware shape. Provides cleaner async semantics (no callback-hell, no missed-`next()` bugs) and unblocks portable runtimes (Workers, Deno) where Express's req/res aren't available. Migration: framework ships a `legacyMiddleware(fn)` wrapper for the old shape during the v6 transition; hard-removed by v7.

- **Strict Content-Type as default.** v5 leaves `app.config.http.strictContentType = false` (lenient — formidable fallback). v6 flips to `true` (415 for unregistered Content-Types). Migration: parser registry (shipped in v5) lets apps pre-register their full Content-Type set before v6 cut.

- **Routing semantic flips: trailing slash + case sensitivity.** v5 matches Express's defaults (lenient + insensitive). v6 flips both to the modern majority: strict trailing slash by default (with opt-in canonical-redirect middleware), case-sensitive by default. URL decoding stays per-segment in both versions (already the safer model in v5).


## Phase ordering

- Phase −1 (baseline) is a hard prerequisite for Phase 0.
- Phase 0 (type contracts) is a sequential prelude — no other phase compiles without it.
- Phase 1 tracks (1a-runtime, 1a-codegen, 1b, 1c) parallelize after Phase 0; 1a-codegen depends on 1a-runtime.
- Phase 2 tracks (2a-d) parallelize after 1b ships.

## Migration philosophy

- **v5 final keeps user-visible behavior as close to current as possible — additive features only.** New modes, helpers, APIs, and infrastructure ship in v5 (RouteRegistry, single-mount adapter, codegen, `bodyParsing: 'raw' | 'none'`, parser registry, project boot hook). Aggressive default-behavior shifts and dispatcher-shape changes (that would force middleware authors to rewrite) wait for v6 with a documented migration. Concrete v6 deferrals: `next()` semantics replaced with awaitable middleware; default Content-Type strictness; any default flip on routing semantics (trailing slash / case sensitivity) that surveys show would break existing apps. v5 stays in beta until tree-based router lands; v6 cuts on schedule.
- Repo is on `5.0.0-beta.45` — pre-release. Within the v5 scope, hard breaks are cheap so long as defaults still match Express's user-visible behavior; no deprecation graveyard.
- Migration is **annotation-only** for controllers (no `get routes()` rewrite). Typically -10 to -50 lines per controller (manual type duplication removed), +1 import line.
- `getHttpPath()` is the URL prefix mechanism — default class-name derivation, overridable in subclasses. Codegen uses runtime introspection on the instance, so no separate static field is needed.

## Conventions

- All gen files (`genTypes.d.ts`, per-controller `*.routes.gen.d.ts`) are TypeScript declaration files — types only, no runtime — gitignored and regenerated by `framework gen` before any `tsc`/`vitest`/`biome` step (CI, dev watch, lefthook pre-commit, `postinstall` hook). The `.d.ts` extension avoids empty `.js` artifacts in `dist/` and skips a tsc emit pass.
- `as const` on `get routes()` is recommended in docs but not enforced — codegen reads the AST directly so literal preservation isn't required.
