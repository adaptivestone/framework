# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.1.3] - Unreleased

### Security

- **`logout` now revokes the session the client actually authenticated with.** `postLogout` re-extracted the bearer token from the `Authorization` header only, while the `GetUserByToken` middleware that authenticates every Auth route accepts the token from `req.body.token` first (a supported path) and falls back to the header. A client that authenticated with a **body** token and called `logout` with that same body token got a `200 Ok` while its session token was never `$pull`-ed — the 30-day token stayed valid, undetectably. Both call sites now resolve the presented token through one shared `GetUserByToken.resolveToken(req)` (body first, then `Authorization`, `'null'` treated as absent, `Bearer` prefix stripped, trimmed), so logout always revokes the exact session the request authenticated with — including the case where a request carries both a body and a header token (the body-authenticated session is the one revoked). Logout without any token still returns `200`. The middleware's behavior is unchanged.

- **Request validation no longer echoes an internal error message to the client.** The validation-phase catch in `src/controllers/index.ts` returned `400 { errors: err.message }` for **any** thrown error, not only a framework `ValidationError` — so an error raised inside a schema's `.transform`/`.test` (e.g. an async validator that hits the database), or the developer-facing "no `ValidatorDriver` matches this schema" message, rode verbatim into the `400` body. A repro leaked a Mongo connection string (`mongodb://admin:s3cret@…`) to an unauthenticated client. A framework `ValidationError` still maps to `400` with the same path-keyed `errors` response body as before; every other error now routes through the same error-handler registry as a handler throw (`app.httpServer.resolveError` — consumer-registered handlers and built-in `HttpError` mapping apply), falling back to a generic `500` with the "Platform error. Please check later or contact support" body, logged at `error`. **Behavior change:** a throwing `.transform`/`.test`, or a schema with no matching driver, now yields a `500` (or whatever the registry maps it to) instead of a `400` that echoed the internal message, and an `HttpError` thrown inside a validator maps to its own status — consistent with how it behaves when thrown from a handler.

### Fixed

- **The CLI now exits non-zero when a command fails.** A command that threw (including a migration whose `up()` rejected) was caught and logged, but the process still exited `0` — so a CI/deploy step running `node cli.ts migration/migrate` treated a failed migration as success and shipped against an un-migrated schema. The failure was swallowed at three layers: `BaseCli.run` caught and returned `undefined`, `Cli.run` discarded the result and returned `true`, and the entry script exited `0` unconditionally. Now `BaseCli.run` returns `false` on a thrown command (the error is still logged with its stack), `Cli.run` returns that result, and the entry exits `process.exit(result ? 0 : 1)`. **Behavior change:** a CLI command that fails (throws, or returns a falsy result — every shipped command returns an explicit boolean) now exits `1`. If your project has its own CLI entry that calls `cli.run()` without using the result, mirror the framework's entry (`process.exit(result ? 0 : 1)`) to get failure exit codes. In a multi-instance deploy, a `migrate` invocation that skips because another instance already holds the advisory lock now counts as **success** and exits `0` — another instance is running the migrations, so the skip is expected and is logged as a warning.

- **Controller routes with a mixed-case path segment below the first level were unreachable, and method-scoped middleware on a case-mismatched key was silently dropped.** The controller route-tree builder keyed static child segments by their original case, while the router's matcher (and `RouteRegistry`) look them up lower-cased. A first-level segment was healed by an incidental re-keying, but a nested route like `get: { '/user/Profile': handler }` produced a tree node the matcher could never reach — a `404` for both `/user/Profile` and `/user/profile`. The same drift meant a `static middleware` map key differing only in case from its route (e.g. `'POST/Login'` vs a `/login` route) attached its middleware (Auth, RateLimiter) to a phantom node — silently not running it — at any depth. The builder now keys segments through the same shared `RouteRegistry.ensureChildBySegment` the matcher uses (single source of truth; the drifted duplicate is removed), so mixed-case routes match case-insensitively at any depth and method-scoped middleware always attaches. A middleware key that points at a non-existent route now logs a warning at boot instead of failing silently. Runtime routing, `req.params` extraction, and the `405`-over-param-backtracking behavior are unchanged.

- **A non-string body `token` no longer crashes the request with a `500`.** `GetUserByToken` read `req.body.token` and called `.replace()` on it with no type check, and body parsing preserves a JSON number and keeps a repeated form field as an array — so a request carrying `{"token": 123}`, or `token` sent twice as a form field, threw `token.replace is not a function` → `TypeError` → the generic `500` sink, instead of being treated as an unauthenticated request. A non-string token is now treated as **absent**: the middleware falls through to the `Authorization` header (and `postLogout`, which shares the same `GetUserByToken.resolveToken`, treats it as no token and returns `200`). A string token behaves exactly as before.

- **Route-type codegen now emits the correct import form for named-export middleware.** The AST resolver classifies each middleware import as `default` or `named` (carrying its original name for an alias), but the emitter discarded that and always rendered a default import (`import type Mw from '…'`). A middleware exported as a **named** export, or a middleware class exported from the controller's own file, therefore produced a `.routes.gen.ts` that either failed to typecheck (`TS2613`: the module has no default export) or silently bound the middleware type to the file's *default* export — a wrong type that surfaced later as a confusing `TS2339` in the handler. The `kind` and original name are now threaded through to emit (via a shared `MiddlewareImport` type), so named and aliased middleware render as `import type { Name } from '…'` / `import type { Orig as Local } from '…'`. Output for default-export middleware — every framework built-in — is byte-identical.

- **`Lock.waitForUnlock` no longer races the change stream into an eternal hang.** The change stream opens its server-side cursor lazily on the first `'change'` listener, and its logical start point is fixed only then — but the old code ran the `findOne` existence check *before* attaching the listener, so a `releaseLock` that committed in that window was never observed: the waiter hung forever (or, with `timeoutMs`, surfaced a spurious timeout while the lock was already gone). The `'change'` listener is now attached first, and the code waits for mongoose's forwarded `resumeTokenChanged` signal (which fires only once the stream's start point is fixed) before the authoritative `findOne` re-check — closing the window. The public API is unchanged and no default timeout was added. **Edge note:** on a standalone MongoDB (change streams unsupported — never a working topology for this API), `waitForUnlock` on an absent lock now rejects with the stream error rather than accidentally resolving.

- **OpenAPI `operationId`s are now unique and controller-namespaced.** The generator emitted the bare handler name (`getList`) as the `operationId` with no uniqueness guard, so two controllers that both define `getList` — or one handler wired to multiple verbs/paths — produced duplicate ids, which OpenAPI 3.1 forbids: validators (Redocly, Spectral, swagger-cli) reject the document and client generators emit colliding function names. Each `operationId` is now namespaced by its controller (`${controllerName}_${methodName}`, the same derivation already used for `tags`) and de-duplicated against a document-wide set — a residual collision (the same handler on multiple verbs/paths) gets a deterministic verb suffix, then a numeric one. **Behavior change (consumer-visible output):** every emitted `operationId` changes (e.g. `getList` → `Users_getList`); regenerate and re-pin any client SDK or tooling that referenced the old ids.

- **A concurrent duplicate registration now returns the same `400` as the sequential existence check, not a `500` for the loser.** `postRegister` (`src/controllers/Auth.ts`) checks for an existing email/nickname and then calls `User.create`, with nothing guarding the window between the check and the insert — so two registrations racing on the same email both passed the checks and the second `create` threw a `MongoServerError` E11000 duplicate-key error, which is neither an `HttpError` nor a Mongoose `ValidationError` and so fell through to the generic `500` sink. A narrow catch around `User.create` now maps E11000 on the `email` unique index to the same `400 email.registered`, and on the `name.nick` index to `400 auth.nicknameExists`, that the pre-insert checks return. A duplicate-key error on any other index is rethrown (an honest `500`); non-duplicate errors propagate unchanged.

- **A non-positive cache TTL now means "don't cache" on every driver, instead of being cached forever in memory.** `Cache.getSetValue` short-circuited only an exact `storeTime === 0`, and `MemoryDriver.set` stored the entry unconditionally while arming its expiry timer only when `ttlSeconds > 0` — so a computed **negative** TTL (e.g. `Math.floor((expiresAt - Date.now()) / 1000)` once the source is already expired) wrote a timer-less, never-expiring entry, and the default memory driver served that stale value forever while Redis (which rejects `EX <= 0`) degraded to no-cache. The short-circuit is now `storeTime <= 0` and `MemoryDriver.set` early-returns on `ttlSeconds <= 0`, so the two drivers agree: a non-positive TTL is not stored. This is strictly a fix — the old memory-driver behavior was never intended (the `=== 0` guard existed precisely so a `0` could not write a never-expiring entry, and a negative value slipped past it) — but the **semantics changed**: a computed non-positive TTL now recomputes every call instead of being served from a permanent in-memory entry.

- **A config that exists only as an env-specific file no longer crashes boot with a cryptic `Cannot find package 'undefined'`.** A config present only as `config/foo.production.ts` with no base `config/foo.ts` left its resolved `default` path undefined, so `loadConfig` built `paths = [undefined]` and `import(undefined)` rejected with `ERR_MODULE_NOT_FOUND` — even when `NODE_ENV` matched the env file. Now, when `NODE_ENV` matches, the env file loads as the config; when it doesn't match, the config behaves exactly like an unknown config name (`getConfig` → warn + `{}`); and boot logs a clear diagnostic naming the config, its env segments, and the missing base file. A config that has a base file is unchanged — an env file still overrides the base.

- **A project checked out under a path containing a space (or on Windows) no longer breaks boot.** `src/folderConfig.ts` and `app.frameworkFolder` (`src/server.ts`) derived a filesystem path from `new URL('.', import.meta.url).pathname`, which leaves percent-encoding in place (a space stays `%20`) and yields `/C:/…` on Windows — so `folderConfig` fed `%20` paths into `fs.readdir` and boot failed with a misleading foldersConfig error. Both now use `fileURLToPath`, like the rest of the codebase.

- **Migrations organized into subfolders now apply in the correct order, and a non-conforming filename refuses to run instead of silently mis-sorting.** The pending-migration sort keyed on `Number(file.split('_')[0])`, but discovery is recursive and yields folder-relative paths, so a subfolder migration like `2024/1699…_x.ts` produced `NaN` and the `NaN` comparator applied migrations in an arbitrary order (`3000_a` could run before `1000_b`). The sort now uses the validated numeric timestamp prefix of the **basename** (directory segments stripped), with ties broken deterministically by full path. A pending migration whose basename doesn't match `<digits>_…` makes `migration/migrate` log an error naming the offending file(s) and return `false` (CLI exit 1) **before** running anything. **Behavior change:** a non-conforming pending migration filename now refuses to run instead of being mis-sorted.

- **A middleware rejection that arrives after the chain already advanced is now logged instead of silently dropped.** `ExpressAdapter`'s one-shot `settle()` returns silently once the middleware chain has resolved, so a middleware that calls `next()` and then awaits a call that later rejects (`next(); await audit.log(req);`) had its rejection consumed with no `500`, no log, and no `unhandledRejection` — the error vanished without a trace. `settle()` now logs such a late rejection at `logger.error` with the middleware class name and its stack. Observability only — responses are unchanged, and a benign double-`next()` stays silent.

## [5.1.2] - 2026-07-05

### Fixed

- **Route-type codegen emitted an empty middleware chain for sibling param routes with different names.** When two routes on the same controller sat at the same position in the route tree but used param segments with **different** names (e.g. `PUT /:slug` and `POST /:event`), the generated `*.routes.gen.ts` gave the sibling whose param name was *not* registered first an empty `UnionAppInfoProvides<readonly []>` — dropping `req.appInfo.user` (and every other middleware-provided field) from its request type, even though that route runs the controller's full middleware chain at runtime. Root cause: the router keeps a single param child per tree node, so same-depth param siblings collapse onto one node named after the first-registered segment (`:slug`); `flatten()` then reconstructs every sibling's path with that name, while codegen looked each route's chain up by its own **source** path (`:event`) and missed. The middleware-chain lookup is now param-name-insensitive (segment names never affect which node a path resolves to), so all siblings resolve their real chain. **Types-only fix — runtime routing, `req.params` extraction, and middleware execution are unchanged** (they were already correct; only the generated types were wrong).

## [5.1.1] - 2026-07-05

### Security

- **Mongoose validation safety net no longer echoes submitted input.** The safety net (added in 5.1.0) mapped an escaped Mongoose `ValidationError` to `400 { errors: { <path>: message } }` using the **raw** Mongoose message. Those default templates interpolate the rejected value (`Path \`title\` (\`<the whole 300-char submission>\`) is longer than …`, `Cast to Number failed for value "<PII>" …`), so the offending input — a phone number, a password pasted into the wrong field, any oversized string — rode into both the `400` response body and the `warn`-level log (and thus Sentry). Each per-path message is now **rebuilt from the validation `kind` + the schema constraint only** (`maxlength: 255` → "Must be at most 255 characters", a `Number` cast failure → "Must be a number", an `enum` violation → "Must be one of: …"), and the submitted value is never included, under any kind. The `warn`-level log line for a safety-net-handled error is sanitized the same way — the logged error is rebuilt with those kind-based messages and a fresh, input-free stack — while an error that stays a **500** (internal/renamed paths, or no registry match) still logs the original in full, since that branch is a server-side defect the developer needs complete detail on. This matches the `YupDriver`, which already strips `value`/`originalValue` from route-validation errors. Messages are plain English, not i18n (the route validator owns user-facing wording; this is a last-resort fallback for a route schema that failed to mirror a model constraint). **Trade-off:** a model-defined *custom* message (`maxlength: [50, 'Name too long']`) is indistinguishable from a templated default that embedded the value, so **all** messages are rebuilt generically — a custom message set on the model is not passed through the safety net. Set user-facing wording on the route `request:`/`query:` schema instead. The `400`/`500` split, the "client actually sent this field" gate, the log levels, and the `{ errors: { path } }` response shape are unchanged.

## [5.1.0] - 2026-07-05

### Added

- **OpenAPI 3.1 generator.** New `openapi` CLI command (`node src/cli.ts openapi [--output <file>]`) emits an OpenAPI 3.1 document from your controllers — paths, path/query parameters, request bodies (single schema or content-type map), security schemes, and tags — all derived from the route definitions you already write. Runs cold: loads controllers without opening a database/network connection or binding a port, so it's safe in CI. See the OpenAPI documentation chapter.
- **Vendor-neutral JSON Schema export on the validator driver seam.** `ValidatorDriver.toJsonSchema` is now implemented (and may return a `Promise`): Zod via native `z.toJSONSchema`, Yup via `.describe()`, ArkType (or any schema exposing a `.toJsonSchema()` method) via its native output. Validators with no introspection (`defineSchema`, custom `~standard` functions) degrade to a placeholder schema. The seam is reusable beyond OpenAPI (e.g. a future MCP surface).
- **`AbstractMiddleware.usedAuthParameters` is now a `static` getter** — the OpenAPI generator reads it off the class to build `components.securitySchemes` with zero instantiation. The instance form is kept for back-compat (removed in v6). `GetUserByToken` declares its `Authorization` header + bearer schemes, so routes behind it are documented as secured automatically.
- Route `description` now surfaces as the OpenAPI operation `summary`, and the controller class name becomes the operation's `tags`. (Internal: `HandlerEntry.meta` gained `description` / `controllerClass`; generated `.routes.gen.ts` output is byte-for-byte unchanged.)
- **Project boot hook (`bootHttp`).** Pass a `bootHttp` function (type `BootHttpHook`) to the `Server` constructor; it's called with the live `app` during `startServer` — after controllers register, before the adapter mounts — as the blessed place for app-wide HTTP wiring that doesn't fit a controller (ad-hoc routes via `app.httpServer.routeRegistry.registerRoute(...)`, Express-level middleware, boot setup). Wired explicitly rather than discovered from a folder (the framework's folders are all owned — config/ merges its files, controllers/ auto-loads its files). HTTP-specific by design (it needs `app.httpServer`, which only exists once the server boots; CLI/worker processes don't run it). Complements the existing `callbackBefore404` (which runs after the mount).
- **`routes` CLI command.** `node src/cli.ts routes` (or `npm run routes`) prints the project's route tree — every mounted method, full path, path/splat parameters, and the accumulated middleware chain per route — by walking the same `RouteRegistry` the server logs at boot. Read-only and boot-based: no database, no port (mirrors the `openapi` command).
- **Runner-agnostic test setup.** The test lifecycle moved into plain async functions (`tests/setupFramework` — `startTestMongo`/`stopTestMongo`, `startTestServer`/`stopTestServer`, `setTestRedisNamespace`/`clearTestRedisNamespace`) with no test-runner import. `tests/setupVitest` + `tests/globalSetupVitest` are now thin wrappers, and a new `tests/setupNodeTest` lets consumers run framework-backed tests under Node's built-in `node:test` (vitest stays an optional peer). The run-once in-memory Mongo is wired through node:test's `--test-global-setup` hook (Node ≥ 24) — the analog of vitest's `globalSetup`. See the testing docs.
- **Cache drivers — `@redis/client` is now optional.** The cache is built on a small `CacheDriver` interface with two first-party drivers: a per-process `MemoryDriver` (new default — needs no external service) and a `RedisDriver` that lazy-imports `@redis/client` only when selected. Choose via `config/cache.ts` (`{ driver: 'memory' | 'redis' }`, or `CACHE_DRIVER` env). A `CacheDriver` instance can be injected directly for a custom backend. The orchestration you rely on — namespacing, in-flight request dedup, JSON/bigint (de)serialization, and fail-soft degradation — is unchanged.
- **Zero-TTL means "don't cache" (issue #10).** `cache.getSetValue(key, fn, 0)` now skips the cache entirely and recomputes every call, instead of writing a never-expiring entry.
- **`getAppInstance()` helper.** `helpers/appInstance` now exports a throwing getter alongside the raw `appInstance` binding: it returns the app singleton, or throws a guided error ("construct the Server first"; tests can use `setAppInstance()`/`resetAppInstance()`) when nothing is set. Prefer it in code that may run before the `Server` is constructed (module scope, lazy imports, external modules) — reading the raw binding there fails later with an opaque `TypeError: cannot read properties of undefined` that gives no hint at the cause.
- **Duplicate-framework-copy diagnostic in the model loader.** When npm fails to dedupe and a model class extends `BaseModel` from a *different* installed copy of `@adaptivestone/framework`, `instanceof BaseModel` is false, so the loader used to silently misroute the class into the legacy (`AbstractModel`) branch — surfacing only as a confusing downstream failure. Boot now recognizes the shape (BaseModel's static `initialize` + `modelSchema` surface without the `instanceof`, via the new `isBaseModelSubclassShape` export) and fails with an error naming the model, the cause (duplicate/undeduped install), and the fix (`npm ls @adaptivestone/framework`, then dedupe). Genuinely legacy models still route to the legacy branch unchanged.
- **Error-handler registry + typed HTTP errors.** Throw `NotFoundError` / `new HttpError(status, message, body?)` (from `services/http/httpErrors.js`) inside a route handler to produce that status (built-in mapper, logged `verbose`), or map error classes you don't own via `app.httpServer.registerErrorHandler(ErrorClass, handler, { logLevel? })` (returns an unregister function) — e.g. from the `bootHttp` hook. Consumer handlers are checked before built-ins; a handler returning `null` passes to the next entry; unmatched errors keep the 500. The Mongoose validation safety net is now a built-in registry entry (semantics unchanged).

### Changed

- **Mongoose validation safety net — some controller 500s are now actionable 400s.** When a route handler throws a Mongoose `ValidationError` from `save()` (e.g. a model `maxLength` the route `request:`/`query:` schema didn't mirror), the wrapped handler no longer always returns a blanket `500`. If **every** failing model path is a field the client actually sent (a key of the validated `req.appInfo.request` ∪ `req.appInfo.query`, excluding the framework-injected `contentType`), it now returns `400 { errors: { <path>: message } }` with the Mongoose messages — the same shape as route-level validation — and logs a `warn` (the route schema is missing a constraint you should mirror). If **any** failing path is renamed or internal (not sent by the client), the response stays a `500` logged as `error`, so a non-public field name never leaks and a server-side bug is never misattributed to the client. **Behavior change:** a request that previously got a `500` for this specific case now gets a `400`. Mirroring model constraints in the route schema remains the recommended practice; this is a fallback, not a contract.
- **`@redis/client` moved from a required dependency to an optional peer dependency.** Both consumers of it — the cache and the `RateLimiter` redis driver — now load it lazily (via dynamic `import()`), so a project that doesn't use the redis driver for either never pulls the package into its import graph and can run without it installed. **Behavior change:** the **default cache backend is now in-memory** (per-process), where it was previously redis-backed. Single-node apps and local development need no change; **multi-node deployments that rely on a shared cache must set `config/cache.ts` `driver: 'redis'` (or `CACHE_DRIVER=redis`) and install `@redis/client`.** The default `RateLimiter` driver is unchanged (`mongo`); its `redis` driver still works and now lazy-loads the client. The cache key `namespace` stays in `config/redis.ts` (shared with the rate limiter).

### Notes

- Response bodies are not yet schema-documented — operations carry generic `200`/`400`/`401`/`404` responses without body schemas. A declared `response:` route field is planned.

## [5.0.1] - 2026-06-20

### Changed

- Widen the optional peer dependency range for `@adaptivestone/framework-module-email` to `^1.0.0 || ^2.0.0`. Email module v2 no longer bundles Pug — template engines are opt-in and registered by the consumer via `Mail.registerTemplateEngine` — so the framework now accepts both the v1 and v2 lines. The dependency remains optional; projects that don't send email are unaffected. See the [email module changelog](https://github.com/adaptivestone/framework-module-email/blob/main/CHANGELOG.md) for v2 migration notes.

## [5.0.0] - 2026-06-19

First stable release of the **v5** series — a major rewrite. v5 is TypeScript-first and ESM-only, replaces Express's hidden router with a framework-owned tree-based router, makes validation validator-agnostic via [Standard Schema](https://standardschema.dev/), and hardens auth and boot.

This section is an upgrade-oriented summary. The granular per-change notes (every `[NEW]` / `[FIX]` / `[BREAKING]`) live in the `5.0.0-rc.1` … `5.0.0-rc.9` entries below; nothing changed in behavior between rc.9 and this release.

### Highlights

- **Full TypeScript support, including Mongoose models.** New `BaseModel` statics-based model type; per-controller route/handler type generation (`npm run gen` → `<File>.routes.gen.ts` + `genTypes.d.ts`) so handler signatures, `req.appInfo`, `params`, and `query` are typed from the real resolved middleware chain. Typed `getConfig` / `getModel`.
- **Tree-based router.** A framework-owned `RouteRegistry` replaces Express's internal router: structural specificity (static > param > splat), per-segment URL decoding, `405` + `Allow`, `400` on malformed paths, HEAD→GET fallback, and a boot-time route-tree log. Walkable by codegen / future emitters.
- **Standard Schema validation.** Yup ≥1.7, Zod, Valibot, and ArkType work out of the box; pluggable `ValidatorDriver` + `ValidateService.register()`; framework-owned `ValidationError` with structured `.issues`.
- **Security hardening.** Random, SHA-256-hashed session / recovery / verification tokens with enforced expiry; per-user-salt versioned scrypt password scheme; standard security headers on by default; account-enumeration oracles closed; credentials no longer written to logs.
- **Robust lifecycle.** Graceful shutdown on `SIGTERM`/`SIGINT` (drains in-flight requests, tears down mongo/redis/logger); fail-fast boot (Mongo and `AUTH_SALT` required); crash-loop protection for clustered workers.
- **Runtime.** ESM-only, Node ≥ 24, runs `.ts` sources natively with no build step. New helpers/models: `AppInstance`, `Lock`, `i18nService`, `IpDetector`, and test helpers (`getTestServerURL`, `serverInstance`).

### Breaking changes (v4 → v5)

Read the `5.0.0-rc.1` entry below for the full text and migration notes; the condensed list:

- **Runtime & deps:** Node ≥ 24, ESM-only (no CommonJS); Express 5, Mongoose 9, Vitest 4, i18next 24, `@redis/client` v6 (RESP3 default). Jest support and `minimist` CLI parsing removed.
- **Validation:** Yup is now an **optional peer dependency** (validator-agnostic Standard Schema). Legacy `{validate, cast}` validators, internal driver classes, and Yup `req:` context in `.test()`/`.when()` removed; `ValidateService` surface trimmed; `relatedRequest/QueryParameters` default to `null`.
- **Routing:** path syntax narrowed to literals, `:name`, and `{*name}` splats — Express 5 optional params (`{:name}`) and inline regex are unsupported; replace bare `_` route params with `*splat`. Route-type codegen requires statically analyzable controllers. OpenAPI/documentation generation removed (returns later with per-vendor `toJsonSchema`).
- **Models & auth:** all models must extend `BaseModel`. `AUTH_SALT` is required (no default) and Mongo is required at boot. Default auth response changed to `{ data: { token, user } }`. On upgrade, **all existing sessions and recovery/verification links are invalidated** (token hardening); passwords migrate silently on next login. `POST /auth/send-recovery-email` and `/auth/send-verification` now return a uniform `200` (no account-existence oracle) — update any frontend that branched on the old `400`. `RateLimiter` now requires `IpDetector` earlier in the chain.
- **Removed / moved:** the email module moved to `@adaptivestone/framework-module-email`; `staticFiles` middleware, `VIEWS` folders, and `nodemailer-sendmail-transport` removed. The package `exports` map is scoped to the public surface — internal subpaths are no longer importable (see "Public API & stability" in the README).

## [5.0.0-rc.9] - 2026-06-15

- **[FIX]** Regression in rc.8: a model whose `modelSchema` reuses a pre-built mongoose `Schema` instance as a (sub-)document definition (`field: SubSchema` or `[SubSchema]` — a standard Mongoose pattern) failed to type-check at every `findOne(...)` call site with `TS2615` ("circularly references itself in mapped type"). The rc.8 marker-scan (`HasTsOverride`) recursed over `keyof Schema`, and a `Schema` instance isn't a constructor, so it wasn't treated as a leaf — the scan descended into the instance's self-referential internals (`childSchemas`, `options`, `session`, …). `IsLeafFieldDef` now treats a `Schema` instance as a leaf (it can carry no `__tsType` marker anyway), so the scan stops there. Type-only; a `tsc`-gate fixture pins it.

## [5.0.0-rc.8] - 2026-06-15

- **[FIX]** Instance methods are now callable on the hydrated document without `this`-binding casts. A method whose body needs a narrower shape can declare an explicit `this: <bridge>` (a populated ref, a non-null plugin-reshaped field, reassignable sibling methods); that bridge was carried verbatim onto the document type, so a direct `doc.method(...)` call failed the this-context check (`TS2684`) — the framework-computed hydrated doc is deliberately not assignable to the narrower bridge — and every call site needed a `(schema.methods.x as …).call(doc, …)` cast. The caller-facing projection now strips the authored `this` (a method accessed on its own document always has the right `this` at runtime), while method bodies stay type-checked against their declared `this`. Purely a type change, no runtime impact; a `tsc`-gate test pins it.

- **[FIX]** A virtual now resolves to its getter's return type on the document (e.g. `doc.fullName` is `string`) instead of the leaked raw definition (`string & { get(): string; options: … }`). The virtuals slot fed to Mongoose's inner document type was the raw `{ get, set, options }` object; it is now the resolved `VirtualType<…>`, matching the override slot. Type-only.

- **[FIX]** `createdAt` / `updatedAt` are now typed as a non-null `Date` on the hydrated document instead of `Date | null | undefined`. Mongoose always sets the timestamps, so the nullable type only forced a needless guard at every read. Type-only change.

- **[FIX]** Cleaner `TsTypeOverride` typing (rc.7 feature). The override mapping no longer recurses into built-in instances (`ObjectId` refs, `Date`, `Map`) — they showed as `ApplyTsOverrides<ObjectId, …>` in hovers though the recursion was a no-op — and a marker-free schema (the common case) now skips the mapping entirely, so its document type is the plain Mongoose inference with no wrapper in hovers and no extra compile work. Type-only; no change to which types resolve, only how cleanly.

## [5.0.0-rc.7] - 2026-06-15

- **[NEW]** Per-field compile-time type overrides for plugin-reshaped fields. A schema field intersected with the new `TsTypeOverride<T>` marker is typed as `T` on `getModel(...).findOne()` results and method `this`, instead of the type Mongoose infers from `type:` — so a field a runtime plugin reshapes (`mongoose-intl`, encrypted fields, custom getters) keeps its static and runtime types in sync, removing the casts that previously bridged the gap. The marker is a phantom (`__tsType`, never set at runtime); applied by a deep mapped type (`ApplyTsOverrides`) that recurses into nested objects and subdocument arrays. Opt-in and a strict **no-op** for any field without the marker, so existing models are unchanged.

## [5.0.0-rc.6] - 2026-06-14

- **[FIX]** The `User` auth helpers are now reusable on a **customized** `User` model without `this`-binding casts. The statics (`getUserByEmailAndPassword`, `getUserBy{Token,Email,VerificationToken,PasswordRecoveryToken}`) and instance methods (`generateToken`, `getPublic`, `send{Verification,PasswordRecovery}Email`) were typed against the framework's own schema (`this: UserModelLite`), so on a project model with a different shape every call site hit `TS2684` and needed a cast. They're now typed against small structural contracts (`UserAuthDoc` / `UserAuthInstance` / `UserAuthModel`, all newly exported) describing only the fields each helper touches — the framework's `User` and a project's replacement both satisfy them, and return types stay precise. This makes the supported customization paths cast-free: `extends User` to **add** fields, or compose (`extends BaseModel` + spread `User.modelStatics` / `modelInstanceMethods`) to **reshape** them (an i18n `name`, a singular `role`, …) — a field-type *replacement* can't go through `extends` (static-getter covariance, `TS2417`). Both paths are documented on the `User` class. A `tsc`-gate test pins them.

- **[FIX]** Config-type codegen no longer drops env-only keys. A config value read straight from the environment with no default (`saltSecret: process.env.AUTH_SALT`) is `undefined` at gen time, so the value-based pass omitted it from `getConfig('…')`'s type and every read needed an `as` cast. Codegen now reads the config **source** (via `oxc-parser`, no value import) and types a bare `process.env.X` as `string | undefined` (and `process.env.X!` as `string`) — from the source, so the result is the same whether or not the var happened to be set during codegen (deterministic output, no `--check` drift). Keys without an env read (literals, `process.env.X || default`) are still typed from their value as before. Secrets are never serialized (types only). Nested keys and `NODE_ENV`-specific config files are handled.

## [5.0.0-rc.5] - 2026-06-14

- **[FIX]** Route-type codegen extends the rc.4 untyped-`.js` degradation to middleware in the `appInfo` provides chain. A controller guarded by an untyped `.js` middleware (no sibling `.d.ts`) produced a gen file that did `import type Mw from './Mw.js'` to build its `UnionAppInfoProvides<…>` chain — a `TS7016` in a strict consumer build with no `allowJs`. Such a middleware is now dropped from both the import and the chain (it contributes nothing to `appInfo`) instead of breaking the typecheck. Typed middleware — `.ts`, `.js` with a sibling `.d.ts`, or the framework's own (bare specifiers ship declarations) — keep their precise `appInfo` contributions. Same incremental `.js` → `.ts` migration goal as rc.4, now covering middleware as well as controllers.

## [5.0.0-rc.4] - 2026-06-14

- **[FIX]** Route-type codegen no longer emits an untyped self-import for `.js` controllers. A schema-bearing controller still written in JavaScript with no sibling `.d.ts` produced a gen file that did `import type Ctrl from './Ctrl.js'`, which fails with `TS7016` ("could not find a declaration file") in a `strict` consumer build without `allowJs` — turning `rc.3`'s now-succeeding `npm run gen` into a red typecheck. Such controllers now degrade gracefully: the gen file skips the self-import and their inline request/query schemas fall back to the base `Record<string, unknown>`. `.ts` controllers (and `.js` with a sibling `.d.ts`) keep precise `InferOutput` types. Unblocks incremental `.js` → `.ts` migration.

## [5.0.0-rc.3] - 2026-06-13

- **[CHANGE]** Route-type codegen now skips controllers it can't statically analyze instead of aborting the whole run. A controller whose `routes` / `middleware` / `getHttpPath` uses a loop, conditional, computed value, or `super` (e.g. one that extends another controller and merges `super.routes`) is skipped with a warning; types are still generated for every other controller, and the skipped one works at runtime (only its generated request types are omitted). Previously a single such controller failed `npm run gen` for the entire project.

## [5.0.0-rc.2] - 2026-06-13

Patch over `rc.1`, fixing a regression for consumers that extend the framework.

- **[FIX]** Restored `./config/*` to the package `exports` map (it was dropped in `rc.1`). Extending a framework default config — `import http from '@adaptivestone/framework/config/http.js'`, then re-exporting an edited copy from your own `src/config/http.ts` — threw `ERR_PACKAGE_PATH_NOT_EXPORTED` and broke app boot. `config/*` is the intended Tier-2 extension surface and is importable again.

## [5.0.0-rc.1] - 2026-06-13

This is a big release that contains a lot of new features and breaking changes. Main feature of that release is full TypeScript support including mongoose models.

### New Features

- **[NEW]** Full TypeScript support, including Mongoose models.
- **[NEW]** New model type: `BaseModel`, simplifying work with TypeScript and based on statics.
- **[NEW]** `AppInstance` helper to access the app instance from anywhere without passing it.
- **[NEW]** `GenerateTypes` command added.
- **[NEW]** `Lock` model for working with locks via MongoDB.
- **[NEW]** `FrameworkFolder` folder added to the app for module usage.
- **[NEW]** Ability to skip Mongo model initialization in CLI environments.
- **[NEW]** Mongo connections in CLI now have unique names, including the command name.
- **[NEW]** Graceful shutdown on `SIGTERM`/`SIGINT`. `Server.startServer()` now installs signal handlers (once per process, skipped under vitest) that stop accepting connections, drain in-flight requests (`httpServer.shutdown()` awaits `close()` and drops idle keep-alive sockets), then tear down mongo/redis/logger via the `shutdown` event — with a single 10s force-exit safety net (the only force-exit timer; the previous per-`shutdown`-event 5s timer in the `Server` constructor is removed). A second `Ctrl-C` falls through to Node's default immediate termination.
- **[NEW]** `GenerateRandomBytes` command added.
- **[NEW]** `IpDetector` middleware for detecting proxies and `X-Forwarded-For` headers.
- **[NEW]** Test helpers getTestServerURL and serverInstance.
- **[NEW]** Rate limiter middleware - add consumeResult function to allow user middleware as a regular rate limiter
- **[NEW]** Ip detector middleware - add getIpAdressFromIncomingMessage function to allow user middleware as a detector of id adresses without middleware
- **[NEW]**  Introduce i18nService (ability to user i18n not only inside middleware)
- **[NEW]** [Standard Schema](https://standardschema.dev/) validation. Yup ≥1.7, Zod, Valibot, ArkType supported.
- **[NEW]** Pluggable `ValidatorDriver` + `ValidateService.register(driver)` for custom validators.
- **[NEW]** `StandardSchemaV1.InferOutput<typeof schema>` for compile-time handler types.
- **[NEW]** Framework-owned `ValidationError` with structured `.issues`. Wire-compatible.
- **[NEW]** Tree-based `RouteRegistry` replaces Express's hidden router internally. Lives on `app.httpServer.routeRegistry`. One global tree, walkable by codegen / OpenAPI / MCP emitters. The Express adapter mounts once (`app.express.use(adapter)`); path matching, parameter extraction, method dispatch, and middleware ordering all live in framework code now. 405 with `Allow` header, 400 on malformed paths, HEAD → GET fallback. Per-segment URL decoding (Spring's `PathPatternParser` model).
- **[NEW]** `app.controllerManager.registerController(ControllerClass, prefix?)` for explicit/programmatic controller registration. Auto-loading uses the same entry point internally. Register late via `Server.startServer`'s `callbackBefore404` hook so routes mount before the 404 handler.
- **[NEW]** Per-controller route type generation: `npm run gen` (alias for `npm run cli generatetypes`) emits `<File>.routes.gen.ts` next to each controller plus `genTypes.d.ts` at the project root. Handler signatures use `import type { PostLoginRequest } from './Auth.routes.gen.ts'` instead of hand-written `req: FrameworkRequest & { appInfo: { request: { ... } } }` intersections. Codegen walks `RouteRegistry.flatten()` so resolved middleware chains exactly match what the runtime executes (no parallel matcher). Gen files are gitignored — recommend `**/*.routes.gen.ts` in your `.gitignore` and `npm run gen && tsc --noEmit` in your `check:types` script.
- **[NEW]** Type contracts in `services/http/types`: `BaseRequestContext`, `BaseAppInfo`, `AppInfoExtensions` (module-augmentation point for app-wide globals), `ProvidesOf<T>`, `UnionAppInfoProvides<MWs>`. Codegen output composes these into per-handler `<MethodName>Request` aliases.
- **[NEW]** `static get provides()` convention on middlewares — declares what the middleware adds to `req.appInfo` (e.g., `GetUserByToken.provides` returns `{ user?: InstanceType<TUser> }`). Codegen reads this; runtime ignores it. Type-only phantom.
- **[NEW]** Boot-time route tree log at `verbose` log level. After all controllers register, the framework prints the full route registry: path structure, per-node attached middlewares (with inherited chain marked separately as `pmw:`), per-method handlers with their absolute path, schema flags (`[body]` / `[query]`), and route-level middleware (`[mw: ...]`). HTTP verbs are color-coded (blue GET, green POST, yellow PUT/PATCH, red DELETE, gray OPTIONS); `:param` and `*splat` segments stand out in magenta. ANSI codes are emitted unconditionally — looks right in TTY consoles, raw codes appear in file/Sentry transports for the one-time boot output.
- **[NEW]** `Server#getLogger()` registers a `shutdown` listener that drains the winston logger (`logger.close()`). Fixes 5s exit stall in CLI commands (`generatetypes`, etc.) caused by winston transport sockets keeping the event loop alive past the shutdown signal. The force-exit safety timer (zombie-prevention) now lives in the graceful-shutdown signal handler — see the SIGTERM/SIGINT entry above.
- **[NEW]** Boot-time warnings on misconfigured routes / middleware Maps. Framework now logs at `warn` level when it sees: unknown verb in the `routes` getter (anything other than `get/post/put/patch/delete/head/options`), a route object missing a callable `handler` field, a non-string key in the middleware `Map`, or an unknown method prefix on a `Map` key (e.g., a typo like `'PATC/login'`). Previously these silently produced 404s at request time.
- **[NEW]** Codegen emits typed `params` for route path segments. `:name` segments and `{*name}` splats are extracted from the path string and emitted as `& { params: { name: string } }` on the generated `<Method>Request` alias. Splats capture multiple segments joined with `/` — typed as `string` (not `string[]`), matching the matcher's behavior. Removes the need for hand-rolled `& { params: { id: string } }` intersections on every handler with a `:param` route.
- **[NEW]** Codegen emits `appInfo.query: StandardSchemaV1.InferOutput<...>` from route-level `query:` schemas. Mirrors how `request:` schemas are already handled — declares it on the route, handlers read typed `req.appInfo.query.X`.
- **[NEW]** Codegen deduplicates identical union branches when one handler serves multiple routes with the same resolved chain + path params + schemas. Prevents `Foo = (X & {...}) | (X & {...})` output in `.routes.gen.ts`.
- **[NEW]** `Pagination` middleware declares `static get provides()` returning `PaginationMiddlewareAppInfo['appInfo']`. Routes with `Pagination` in their chain get `req.appInfo.pagination: { page, limit, skip }` typed automatically.
- **[NEW]** Middleware request/query schemas can be declared **statically** — `static get relatedRequestParameters()` / `static get relatedQueryParameters()`. The framework reads them without instantiating the middleware (avoids constructor side effects during route setup / codegen). Framework middlewares (`Pagination`) migrated.
- **[DEPRECATED]** The **instance** form of those getters (`get relatedRequestParameters()` / `relatedQueryParameters` / `relatedReqParameters`) is deprecated and **will be removed in v6** — migrate to the static form. It still works (the framework detects the override, instantiates as a fallback, and emits a one-per-class `DeprecationWarning`, code `ASF_DEP_MW_INSTANCE_SCHEMA`).
- **[FIX]** `setupVitest.ts` no longer imports framework-internal fixtures. The test-fixture controller (`SomeController`) is now registered inside its own test file via late `controllerManager.registerController()` (the adapter reads the registry live, so registration after `startServer` works). Consumer projects can use `@adaptivestone/framework/tests/setupVitest.js` without `Cannot find module './fixtures/...'` errors. `frameworkVitestSetup.*` is now `.npmignore`'d as framework-only.
- **[FIX]** Codegen now walks the `extends` chain when resolving middleware import paths. A child controller that inherits `static get middleware()` from its parent class no longer has those middlewares filtered out of its generated chain — codegen scans the parent's source file for the import line and emits the right `import type` in the child's `.routes.gen.ts`. Bare-package ancestors (e.g. a consumer extending the framework's `AbstractController` via `@adaptivestone/framework/modules/...`) are resolved too (since beta.55): codegen reads the installed package file through the importing file's module resolution (honoring the package `exports` map) and rewrites the ancestor's relative middleware imports into bare specifiers the consumer's gen file can resolve — the public subpath tree mirrors `src/`.
- **[FIX]** `getConfig()` types in `genTypes.d.ts` are emitted as inline **value-shape** types — each config value's structure rendered with value *types* (`string`, `number`), never the literal values and never an `import()` reference. This avoids baking secret values into the generated file and avoids over-narrow literal types, while staying robust: the type is fully inline (no module resolution, so it can't silently degrade to `any` under stricter or preview TypeScript toolchains), and arrays stay **tuples** so per-element patterns like `Object.values(config.list[0])` keep precise types. (Replaces an earlier `typeof import('./config/foo.ts').default` reference form, which inferred array elements as a union with `?: undefined` keys — breaking `Object.values()` — and could resolve to `any` on some compilers.)

### Breaking changes (please read carefully)

- **[BREAKING]** No more global variables for testing and default user will not be created by default
- **[BREAKING]** All models now should be extended from `BaseModel`. This is a potential breaking change specially for `User` model.
- **[BREAKING]** Remove jest support for testing.
- **[BREAKING]** Move email module to separate package `@adaptivestone/framework-module-email`. Please use it if you want to send emails.
- **[BREAKING]** Remove `VIEWS` folders at all. Should not affect any user as this was not used internally.
- **[BREAKING]** Removed `noidemailer-sendmail-transport`. Not needed anymore and not recommended to use as well.
- **[BREAKING]** Remove `minimist` CLI parsing and replace it by `commandArguments` parser.
- **[BREAKING]** `vitest` v3 <https://vitest.dev/guide/migration.html>.
- **[BREAKING]** `i18next` v24 <https://www.i18next.com/misc/migration-guide#v23.x.x-to-v24.0.0>.
- **[BREAKING]** Possible breaking. Framework start using express 5 instead of express 4. Please follow express migration guide too <https://expressjs.com/en/guide/migrating-5.html>.
- **[BREAKING]** As part of express 5 migration `_` in rotes (middlewares) should have perameter. please replace `_` to `*splat`.
- **[BREAKING]** Default auth response changed to be unified. `{token, user}` => `{data:{token, user}}`.
- **[BREAKING]** `RateLimiter` now need to have `IpDetector` middleware before.
- **[BREAKING]** Removing `staticFiles` middleware as it not used in projects anymore. Docs with nginx config will be provided.
- **[BREAKING]** Remove default `AUTH_SALT`. It should be provided on a app level now.
- **[BREAKING]** Auth tokens & password hashing hardened (security). Session, password-recovery, and email-verification tokens are now random (`randomBytes`) and stored as SHA-256 hashes with an enforced expiry filter; passwords use a per-user random salt + a versioned scrypt scheme (`v2:scrypt:…`) with `AUTH_SALT` as a pepper. **On upgrade, all existing sessions, password-recovery links, and email-verification links become invalid** — stored plaintext tokens no longer match the hashed lookups, so users must log in again / request new links. Passwords migrate silently: a legacy hash is re-hashed to the new scheme on the user's next successful login (no batch migration is possible — the plaintext only exists at login). The login/recovery wire format is unchanged.
- **[BREAKING]** Minimum Node version is **24.0.0** (enforced via `engines`). The framework runs your TypeScript sources directly, with no build step, which relies on Node's native type stripping.
- **[BREAKING]** ESM only. No more commonJS. That help to fix a lot of bugs with tests and provides better development expirience.
- **[BREAKING]** Mongoose v8. <https://mongoosejs.com/docs/migrating_to_8.html>.
- **[BREAKING]** Mongoose v9. <https://mongoosejs.com/docs/migrating_to_9.html>.
- **[BREAKING]** Vitest v4 <https://vitest.dev/guide/migration.html#vitest-4>
- **[BREAKING]** `@redis/client` v6. Now defaults to the RESP3 protocol (was RESP2) and requires a Redis ≥6 server; pass `createClient({ RESP: 2 })` to keep v5 wire behavior. Also adds a default 5s command timeout. <https://github.com/redis/node-redis/blob/master/docs/v5-to-v6.md>
- **[BREAKING]** Yup is no longer bundled — it's now an **optional peer dependency** (`^1.7.0`). The framework runtime is validator-agnostic (Standard Schema) and fully decoupled from yup; built-in controllers use the zero-dependency `defineSchema` helper. Bring your own validator only if you want one — yup (≥1.7, which implements Standard Schema natively), zod, valibot, or arktype. If your own schemas use yup, add it to your `dependencies`.
- **[BREAKING]** Legacy `{validate, cast}` plain-object validators removed. Wrap as Standard Schema (~10 lines).
- **[BREAKING]** Yup `req:` context inside `.test()` / `.when()` removed. Use `this.parent` or move logic to handler.
- **[BREAKING]** Internal driver classes (`AbstractValidator`, `YupValidator`, `CustomValidator`) removed.
- **[BREAKING]** `ValidateService` surface trimmed to `{constructor, validate, resolve, register}`. Helpers like `validateReqData` removed.
- **[BREAKING]** `AbstractMiddleware.relatedQueryParameters` / `relatedRequestParameters` defaults changed from `yup.object().shape({})` to `null`. Override with any Standard Schema-conformant schema.
- **[BREAKING]** `BaseAppInfo.i18n` is now required (was optional in `FrameworkRequest`). Reflects runtime reality: `I18nMiddleware` is part of `HttpServer`'s default chain. If you removed I18n from your global chain, augment `BaseAppInfo` to relax the field.
- **[BREAKING]** OpenAPI / documentation generation removed: `framework documentation` and `framework getOpenApiJson` CLI commands, `DocumentationGenerator`, and `app.documentation` field deleted. Output was already partial after Standard Schema migration. Will return in later with per-vendor `toJsonSchema` support.
- **[BREAKING]** Path-pattern syntax narrowed. The new tree-based router supports literal segments, `:name` params (exactly one segment), and `{*name}` splats (zero or more segments to end of path). **Express 5's optional-param `{:name}` and inline regex are NOT supported.** If you had routes like `/fullpath/:paramOne/{:paramTwo}`, split into two explicit routes (`/fullpath/:paramOne` + `/fullpath/:paramOne/:paramTwo`) or restructure. Specificity is structural (static > param > splat); URL decoding is per-segment.
- **[BREAKING]** `AbstractController` constructor third argument `isExpressMergeParams` removed. The old default Express-router behavior of stripping parent params is gone — all matched params (across the full path, including the controller prefix) are available on `req.params`. If you relied on the merge-params toggle, no action needed in most cases; if you specifically depended on the strip behavior, restructure your handler to filter `req.params` keys.
- **[BREAKING]** The built-in `Home` controller no longer runs `GetUserByToken` globally. It previously declared `'/{*splat}': [GetUserByToken]`, and since `Home` mounts at `/` that landed on the route-tree root and ran on **every request**. `Home` now adds no middleware. Controllers still parse the token via their own/inherited `[GetUserByToken, Auth]`; only routes that don't include it themselves (e.g. ad-hoc `registerRoute` endpoints) lose the implicit `req.appInfo.user`. See the beta.55 note below.

### Bug Fixes

- **[FIX]** Codegen's `extends`-walk now follows the *exported* controller's parent, not the first `class … extends` in the file. A helper or secondary class declared before the controller (e.g. `class Helper extends X` … `export default class Ctrl extends Y`) used to hijack the walk, so middleware inherited from the controller's real parent was silently dropped from the generated `req.appInfo` types. The parent is now resolved from the `export default`/`export class` declaration (falling back to the last `class … extends`).
- **[FIX]** Codegen's import scanner now parses semicolon-less (ASI) imports. Statements were terminated only at `;` or end-of-file, so under a no-semicolon style (Prettier `semi: false`, StandardJS) consecutive `import` lines collapsed into one and all but the first binding were dropped — quietly losing those middlewares' type narrowing. A statement now also ends at the newline after its specifier string closes; `;`-terminated, multi-line `{ … }`, and side-effect (`import './x'`) imports are unaffected.
- **[FIX]** The `extends`-walk no longer mistakes a **regex literal** for a class declaration. `parseExtendsParent` scanned the whole file, so a regex such as `/export default class Z extends Wrong/` lexically before the real controller hijacked the walk and dropped the controller's inherited middleware. Regex-literal bodies are now blanked (alongside comments and strings) before the scan.
- **[FIX]** A controller whose exported class has **no `extends`** (`export default class Ctrl {}`) no longer inherits a helper class's parent. The scan used to fall through to the last `class … extends` in the file — a sibling helper's — and merge its middleware; it now returns "no parent" when the exported class declares none.
- **[FIX]** A malformed import specifier with a **trailing backslash** (`import X from './a\'`) no longer breaks the generated file or swallows the imports that follow it. Specifiers containing a backslash or a Unicode line separator (U+2028 / U+2029) are now rejected, and the scanner no longer honors `\`-escapes inside a specifier (a real one has none), so the string closes at its quote.
- **[FIX]** Multi-line import-attributes clauses (`import x from './x.json'` then `with { type: 'json' }` on the next line) no longer end the import prologue early and drop every later import; the clause is folded into the statement.
- **[FIX]** `req.appInfo.user` is typed as the hydrated **document**, not the Mongoose model class. Codegen's `AppModels` augmentation emitted `User: GetModelTypeFromClass<…>` (the model class) where the runtime assigns `InstanceType<…>`, so after `npm run gen` `user.id` / `user.email` stopped type-checking. The augmentation now wraps the model in `InstanceType<GetModelTypeFromClass<…>>` (while `getModel('User')` correctly keeps returning the class). Verified with a `tsc` probe.
- **[FIX]** Codegen now skips colocated `.d.ts` / `.gen.d.ts` files when discovering controllers, matching the runtime loader. A capitalized declaration file next to your controllers passed the `.ts`-only filter, reached the AST extractor, parsed as "no controller class," and — since non-analyzable controllers are a hard error — made `npm run gen` throw, blocking route-type generation for *every* controller.
- **[FIX]** A non-literal `static get middleware()` in an **ancestor** controller is no longer silently dropped. The `extends`-walk treated "this ancestor builds its middleware Map dynamically" the same as "this ancestor declares no middleware," so it walked past and emitted the child with an empty middleware chain (and `req.appInfo` missing those fields) with no error. It now stops and throws, naming the controller — symmetric with the same getter on the controller itself.
- **[FIX]** A route entry with no statically identifiable handler — object shorthand (`{ handler }`), an optional-chained handler (`this?.x`), or a spread (`{ ...defaults, handler }`) — now throws instead of silently dropping the route from the generated types.
- **[FIX]** Codegen's `extends`-walk now also follows the `export { Ctrl as default }` form (including the ES2022 string-literal name `export { Ctrl as "default" }`). Previously only `export default …` was recognized; the `as default` re-export fell through to "last class wins," so a trailing helper class could hijack the walk (wrong `extends` / routes).
- **[FIX]** Codegen now discovers **`.js` controllers** like the runtime loader does. A plain-JavaScript controller used to be invisible to `npm run gen`: it got no `.routes.gen.ts`, and — since codegen computes cross-controller middleware bleed from all controllers at once — its root-scoped middleware was missing from *other* controllers' generated `req.appInfo` types. `.js` sources are parsed by the same AST front-end (`.gen.js` / `.test.js` are skipped, mirroring the loader), and the gen file's self-import keeps the controller's real extension.
- **[FIX]** `RateLimiter` no longer turns a **backing-store outage into a 429 for everyone**. `rate-limiter-flexible` rejects with a `RateLimiterRes` when the limit is hit but with an `Error` when the store (Redis/Mongo) fails; the middleware treated both as "limit hit" and returned `429 Retry-After: 1` on every request during an outage (and logged "Too many requests", misdirecting investigators). Store errors are now distinguished (`instanceof Error`) and **fail open** with an error-level log; the redis/mongo limiters also get a `RateLimiterMemory` **insurance limiter** so brute-force protection degrades to per-process memory instead of vanishing.
- **[FIX]** `Cache.getSetValue` no longer **deadlocks a key forever** when Redis fails mid-request. The request-coalescing map entry was only cleared on the happy path, so a Redis error after the entry was stored left a permanently-pending promise that every future call for that key awaited — surviving Redis recovery. The whole body is now wrapped so the entry always settles and clears (`finally`); the in-flight promise gets a no-op `.catch` (no `unhandledRejection` when a single caller's `onNotFound` throws), the cache write is best-effort (logged, never fails the request), and an `undefined` result skips the write instead of crashing. A cache **read/connect failure now degrades to computing the value via `onNotFound`** (cache outage ≠ request outage — slow, not broken) rather than throwing; only `onNotFound`'s own errors propagate.
- **[FIX]** A failed HTTP `listen()` (`EADDRINUSE` / `EACCES`) no longer leaves a **silent zombie process**. The server socket had no `'error'` listener, so a bind failure surfaced as an `uncaughtException` that the global handler only logged — the process kept running, healthy-looking to a supervisor that doesn't probe the port, while serving nothing. The bind error is now caught and the process exits non-zero so a supervisor restarts it with backoff.
- **[FIX]** Custom (non-console, non-sentry) winston transports now actually load. The constructor check in `#createLogger` was **inverted** — a transport whose default export *is* the constructor (every normally-published winston transport) failed the guard, got a "not a constructor" log, and was silently dropped; only an unusual CJS double-wrapped shape happened to load. The export is now unwrapped (default export, then the CJS-interop `default.default`) and validated **once** before `new`, and the dynamic `import()` has a `.catch` so a typo'd module name logs a friendly error instead of an unhandled rejection.
- **[FIX]** Boolean environment variables are no longer coerced backwards. `config/log.ts` read `process.env.LOGGER_SENTRY_ENABLE || false` and `… || true`, but env values are strings — `"false"`/`"0"` are **truthy**, so `LOGGER_SENTRY_ENABLE=false` *enabled* Sentry and `LOGGER_CONSOLE_ENABLE` could never disable the console. A new `envBool(name, default)` helper (`src/helpers/env.ts`) parses them explicitly (only `"true"`/`"1"` are `true`; unset/empty falls back to the default), and both log flags now use it.
- **[FIX]** The migration runner no longer silently skips **branch-merged migrations**. Pending files were chosen by comparing each filename timestamp against the timestamp of the *most recently applied* record — so a migration merged in later but stamped earlier than one already deployed was filtered out and **never ran** (no error, no log). Pending is now a **set difference** against the applied filenames (`distinct('migrationFile')`), so any unapplied file runs regardless of timestamp ordering, executed in filename order (run-then-record preserved). The run is also wrapped in the `Lock` model (`acquireLock('migrations')`) so two simultaneous deploys can't run migrations twice; a run that can't take the lock warns and returns `false`.
- **[FIX]** `Lock` model correctness. (1) `acquireLock` **steals an expired lock atomically** — `findOneAndUpdate({ _id, expiredAt: { $lt: now } }, …, { upsert: true })` instead of `create`, so a crashed holder's lock is reclaimable immediately rather than after Mongo's TTL-reaper lag (up to ~60s); the unique-`_id` upsert race still yields exactly one winner under contention. (2) `waitForUnlock` registers its change stream **before** re-checking existence (closing a missed-delete window where the promise could hang forever), adds an `'error'` handler (an unhandled stream error — e.g. on a non-replica-set Mongo — would otherwise crash the process), and accepts an optional `timeoutMs`. Locks remain **advisory** — no ownership token, `releaseLock` is unconditional; release only from the flow that acquired it — now documented on the statics.
- **[FIX]** `RequestParser` (the global multipart/urlencoded/json body parser) now bounds and cleans up file uploads, and normalizes field shapes. **(1) Limits:** it ran on every request with formidable's defaults (~200 MB/file, no total/count cap), so any unauthenticated client could spool large bodies to any path. Conservative limits now come from `config.http.requestParser` (`maxFileSize` 20 MB, `maxTotalFileSize` 50 MB, `maxFiles` 10, `maxFields` 1000, `maxFieldsSize` 2 MB; per-mount params override), and limit-exceeded errors return **413** instead of 400. **(2) Temp-file cleanup:** spooled files were **never deleted** (disk exhaustion over time). Every file formidable opens is now unlinked when the response finishes (`finish`) or aborts (`close`) — a handler that wants to keep an upload must move/copy it before responding. **(3) Field shapes:** multipart/urlencoded fields arrive as arrays while json fields are scalars; a single-value field is now collapsed to a scalar (json untouched, repeated keys stay arrays), fixing consumers like `GetUserByToken` that did `token.replace(...)` and threw a 500 on a urlencoded token.
- **[DOCS]** The per-route `bodyParsing` option now documents that **only `'parsed'` takes effect** — `'raw'` and `'none'` are reserved for v5.1 and currently do nothing (the parser is mounted globally, so `req.rawBody` is never set and the stream is always consumed). The matcher plumbing for the mode ships in v5; the implementation (parser registry + `req.rawBody`, enabling webhook signature verification) is planned for v5.1. Previously the type/JSDoc advertised `'raw'`/`'none'` as working.
- **[BREAKING]** **[SECURITY]** `POST /auth/send-recovery-email` and `POST /auth/send-verification` no longer leak account existence. They returned **400** (`auth.errorUExist`) for an unknown email and **200** for a known one — a clean unauthenticated oracle for "does this address have an account." Both now return an identical **200** regardless (the work happens only for a real account), with a generic message (`auth.recoveryEmailSent` / `auth.verificationEmailSent`, added to `en`/`ru`). The email dispatch is **fire-and-forget** (errors logged), so the known-email path doesn't block on token generation + SMTP — closing the response-latency timing oracle too. **Wire change:** frontends that branched on the old 400 must update — treat 200 as "if the account exists, an email was sent." (`register` still reports duplicate email/nickname — registration inherently confirms existence — and stays rate-limited via the controller's `RateLimiter`.)
- **[SECURITY]** Stop writing live credentials to logs. `GetUserByToken` logged the raw body token **and** the full `Authorization` header at `verbose`; `Auth.ts` logged the **entire user document** (password hash + all session/recovery/verification tokens) at `debug` during verify/recovery; `CreateUser` logged `JSON.stringify(user)` at `info`. With Sentry wired or debug/verbose enabled, those reached log storage / a third party. All now log identifiers only — token/header **presence** (not value), and `user.id` / `email` instead of the document.
- **[NEW]** **[SECURITY]** Standard security response headers, **on by default**, applied to every response path (routes, 404, 405, errors — mounted globally before the adapter). `config.http.securityHeaders` ships `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`. `Strict-Transport-Security` is in the config but **off by default** (sending HSTS while also serving plain HTTP in dev causes browser lock-in — set `max-age=…; includeSubDomains` when always behind TLS). Set any header value to `null` to omit it, or `enabled: false` to turn the whole set off. No `helmet` dependency. `x-powered-by` remains disabled.
- **[SECURITY]** CORS config hardening (docs + boot warning, no behavior change). `config.http.corsDomains` no longer recommends `[/./]` (which reflects **every** origin); the comment now points to explicit origin strings and **anchored** regex examples — an unanchored `/example\.com/` also matches `evil-example.com` and `example.com.attacker.io`. The `Cors` middleware logs a boot-time warning for any regex origin that isn't anchored (`^…$`). Matching semantics and the (still-absent) `Access-Control-Allow-Credentials` are unchanged.
- **[BREAKING]** Package `exports` are scoped to the intended public surface instead of a global `"./*": "./dist/*"` wildcard, which had made **every** internal file (`codegen/*`, `commands/*`, `config/*`, routing internals, …) importable and therefore semver-frozen the moment 5.0 lands. Exported now: `server.js`, `Cli.js`, `types.js`, `folderConfig.js`, `modules/*`, `models/*`, `helpers/*`, `services/*`, `controllers/*`, `tests/*`, `migrations/*` (`Cli.js` is the consumer CLI bootstrap — `import Cli from '@adaptivestone/framework/Cli.js'`). Internal subpaths (`codegen/*`, `commands/*`, `locales/*`, top-level entries) are no longer importable as `@adaptivestone/framework/<path>` — they were never intended public API, and the CLI loads commands/migrations by filesystem path (unaffected). The bare-specifier paths codegen emits (`server.js`, `models/*`, `modules/*`, `services/*`) all remain exported. See the README "Public API & stability" section for the tier policy that licenses refactoring `helpers/*` and `services/*` in minors.
- **[FIX]** **Fail fast at boot** (policy: fail at boot, stay up per-request). (1) A model that fails to initialize now **throws** — naming the model and its file — so `startServer` rejects, instead of being logged-and-skipped and resurfacing later as a confusing request-time crash. (2) `AUTH_SALT` is asserted at boot when the auth flow is active; missing → boot throws with the `npm run cli generateRandomBytes` hint (`config/auth.ts` now reads `process.env.AUTH_SALT` honestly — the boot check owns the messaging). (3) `uncaughtException` now logs and `process.exit(1)` — after an uncaught throw the process state is undefined, so a visible crash-loop under an orchestrator beats serving from a corrupted state (`unhandledRejection` stays log-only). (4) The Express 500 handler logs via winston and guards `res.headersSent` — a handler that throws mid-stream no longer crashes with `ERR_HTTP_HEADERS_SENT`.
- **[NEW]** **Mongo is required, and boot enforces it.** `startServer` now throws if no Mongo connection string is configured (`MONGO_DSN`) — rather than lazily skipping models and letting every database-using route 500 at request time. The AUTH_SALT boot check is correspondingly unconditional. Disable or replace any built-in controller (e.g. the built-in auth) by filename-shadowing it in your controllers folder (documented in the README). The default controller middleware stays `[GetUserByToken, Auth]` (secure-by-default).
- **[FIX]** One-Server-per-process is now an explicit contract. The second-`Server` throw — previously a bare "App instance is already set" — explains the rule and points at the fix (per-file test isolation, or the new **test-only** `resetAppInstance()` from `helpers/appInstance.ts`, which clears the singleton but NOT mongoose/redis/env state). Documented in the README.
- **[FIX]** `Sequence.getSequence` passes the id to `findByIdAndUpdate` directly (was a filter object that only worked by accidental Mongoose casting) and retries once on the E11000 upsert race.
- **[FIX]** Pagination `?limit=abc` / `?limit=-5` no longer become an unbounded query — a malformed or non-positive limit falls back to the configured default and is clamped to `maxLimit` (`0` meant "no limit" to Mongoose and bypassed the cap).
- **[FIX]** The route adapter stops the middleware chain when the client aborts mid-request (`res.destroyed`), not just on normal completion; the controller validation wrapper guards `res.headersSent` before its 400/500 (a handler that already streamed no longer crashes with `ERR_HTTP_HEADERS_SENT`).
- **[FIX]** CLI argument handling (`BaseCli`): required-check uses `=== undefined` (so `--flag=false` / `--name=""` satisfy a required option), an unknown flag prints usage instead of crashing, the extension strip uses a suffix regex, and a user-set `MONGO_APP_NAME` is no longer clobbered.
- **[FIX]** Request logs record the path, not `req.url` — the query string can carry secrets (e.g. `?verification_token=…`). `clearNamespace` uses non-blocking `SCAN` with a `${namespace}-` prefix instead of `KEYS *namespace*`. A missing configured folder throws a message naming the folder/path instead of a raw `ENOENT`.
- **[NEW]** Clustered deployments: the primary forwards `SIGTERM`/`SIGINT` to workers (each drains via its own handler) and exits once they're gone.
- **[CHANGE]** The auth config option `isAuthWithVefificationFlow` was renamed to `isAuthWithVerificationFlow` (the previous spelling was a typo). The old key still works but logs a one-time deprecation warning and will be removed in v6.
- **[SECURITY]** Resetting a password (`POST /auth/recover-password`) now revokes all of the user's existing session tokens, so any session created before the reset is invalidated.
- **[CHANGE]** Removed dead code: the unused `src/views/*.pug` templates (no `pug` dependency), the unread `config.validate.controllerValidationAbortEarly`, the no-op `consoleLogger` level filter, and the debug `console.log` on the prod entrypoint.
- **[CHANGE]** Added a packaging smoke test (`npm run smoke`, CI workflow `packaging.yml`): packs the tarball, installs it into a throwaway consumer, and verifies the **published dist** — public entry points import (catching broken built-import paths, the cluster-bug class) and internal subpaths stay unexported (the exports map). The TS-source test suite can't see dist-only breakage.
- **[FIX]** Router static-child lookup is now **O(1)** instead of a per-request linear scan. The tree matcher's `lookupStaticChild` walked every static child of every node on the path with a `toLowerCase()` allocation per child — and since `caseSensitive` is always `false` in production, that scan was the *only* path requests took (the O(1) branch was dead). Static children are now keyed by lowercase segment at registration time, so the now-always case-insensitive match is a single `Map.get`. Nodes keep their original-cased `segment` (display / `formatTree` / codegen paths unchanged — gen output byte-identical). Segments differing only by case now fold onto one node (case-insensitive matching already treated them as one); a same-method collision surfaces via the existing conflicting-handler error.
- **[FIX]** Redis connection helper now caches the **connect promise**, not the bare client. A second concurrent caller could get the client before its `connect()` resolved (double-connect on a half-built socket), a failed first connect cached a dead client forever (no retry), and the synchronous accessor fired `connect()` in an uncaught IIFE (process-level `unhandledRejection` when Redis was down at boot). Concurrent callers now await one connect, a failed connect clears the cache so the next call retries, and the sync accessor logs connection failures instead of crashing.

### Internal

- **[CHANGE]** `npm run gen` now generates types from a single **AST front-end** (`oxc-parser`) — the boot-based codegen (`importResolution`, the ghost controller, app boot) has been removed. It parses controller and model sources directly, reuses the real `RouteRegistry.flatten()` for middleware chains, and emits — with **no app boot, no model imports (no Mongoose load), and no live-class identity matching** (the binding is read straight off the import node, retiring the whole regex reconstruction bug class). For declarative controllers the output is **byte-identical** to the old codegen (proven against the framework's own `Auth`/`Home` + fixtures before the boot path was removed); literal `routes`, `static get middleware()`, `getHttpPath()`, content-type request maps, and route-level `middleware` are all supported. Adds `oxc-parser` as a dependency (codegen runs in consumer projects).
- **[BREAKING]** Route-type codegen requires **statically analyzable controllers**. A controller whose `routes` / `static get middleware()` / `getHttpPath()` is built dynamically (loops, conditionals, computed values) can no longer be reflected — `npm run gen` now throws and names the controller instead of booting the app to read it. Make those getters return literal structures (the framework's own controllers and the audited consumer projects already do).

---
## [5.0.0-beta.55] - 2026-06-06

- **[FIX]** Codegen no longer emits an empty middleware chain for a controller's root (`/`) route. `chainFor` keyed the flattened-route lookup with a trailing slash for a `/` route under a non-root prefix (e.g. `POST /` on a controller mounted at `/file` was looked up as `POST /file/` while `RouteRegistry.flatten()` emits `POST /file`), so the route's middleware came back empty and the generated `req.appInfo` lost every middleware-provided field. Path joining now mirrors the registry (segment join, no trailing slash).
- **[FIX]** Codegen resolves middleware whose local import binding differs from its exported class name. The emit step matched chain entries against the controller's imports by class name, but the import map is keyed by the local binding — so a default export imported under another name (e.g. `import Auth from '.../Auth.js'` where the class is `AuthMiddleware`) was dropped from the generated type (and would otherwise have emitted an unbound `typeof AuthMiddleware`). The live class is now carried through and matched by module identity to recover the real binding (`Auth`). Affected the built-in `Auth` and `Role` middlewares.
- **[FIX]** Codegen resolves inherited default middleware through **bare-package** ancestors. A consumer controller relying on `AbstractController`'s default `static get middleware()` (without re-declaring it) extends the framework via a bare specifier (`@adaptivestone/framework/modules/AbstractController.js`); codegen previously skipped such ancestors, leaving the inherited `[GetUserByToken, Auth]` out of the generated `req.appInfo` type. Codegen now resolves the ancestor through the importing file's module resolution (honoring the package `exports` map) and rewrites the ancestor's relative middleware imports into bare specifiers the consumer's gen file can resolve. Re-declaring the middleware Map is no longer required to get typed `appInfo`.
- **[FIX]** Codegen rebases inherited middleware import paths when the parent controller lives in a **different directory** than the child. The `extends`-chain walk previously emitted the ancestor's relative import paths verbatim — correct only when parent and child share a folder — so a controller inheriting middleware from a parent elsewhere in the tree got a wrong relative path (and the middleware was then silently dropped from the type when the path failed to resolve). Ancestor relative imports are now rebased to the child's gen-file directory.
- **[NEW]** Golden-fixture codegen test (`src/codegen/routeTypes.golden.test.ts`): runs the real boot-free `generateRouteTypes` over fixture controllers, then `tsc`-checks the generated types against handlers that read `req.appInfo.user` without a guard. String-level assertions can't catch a wrong *type* (e.g. an empty `UnionAppInfoProvides<readonly []>`); this gate type-checks the output and would have caught every codegen bug fixed in this release.
- **[FIX]** `Auth` middleware now narrows `req.appInfo.user` to **required**. `AuthMiddleware` rejects unauthenticated requests at runtime but declared no `provides`, so behind `[GetUserByToken, Auth]` the user stayed optional (`user?`) and every handler needed an `if (!user)` guard purely to satisfy types. It now declares `static get provides()` returning `{ user: InstanceType<TUser> }`; `UnionAppInfoProvides` intersects it with `GetUserByToken`'s optional `user?` and collapses to a required `user`. Type-only — runtime unchanged.
- **[FIX]** `req.appInfo.user` now follows a project's OWN `User` model when it replaces the framework's, instead of always typing as the framework `User`. `GetUserByToken`/`Auth` resolve the user type through an augmentable `AppModels` interface (exported from `models/User.ts`), and `npm run gen` emits the binding into `genTypes.d.ts` automatically — the same mechanism that already types `app.getModel('User')`. Falls back to the framework `User` when not replaced; no consumer action needed beyond running codegen. (Previously the middleware `provides` hardcoded the framework `User`, so a replaced model's fields were missing from `appInfo.user` even though `getModel('User')` was correct.)
- **[CHANGE]** Removed the unused `source` field from `MiddlewareEntry` (`services/http/routing`). It was a write-only placeholder that no code read — codegen resolves middleware import paths from controller source instead — so it and its plumbing through `normalizeMiddleware`/`normalizeMiddlewares` are gone. If you constructed `MiddlewareEntry` objects directly (rare), drop the `source` property.
- **[BREAKING]** The built-in `Home` controller no longer registers `GetUserByToken` on a root-level `'/{*splat}'` scope. Because `Home` mounts at `/`, that middleware landed on the route-tree root and ran on **every request app-wide** — a hidden global default that couldn't be opted out of (a controller declaring empty middleware still ran it). `Home` now adds no middleware (it's a public route); controllers still parse the user token via their own/inherited `[GetUserByToken, Auth]`. **Impact:** if you relied on `req.appInfo.user` being populated on routes that don't themselves include `GetUserByToken` (e.g. ad-hoc `registerRoute` endpoints), add the middleware explicitly. Re-add `[GetUserByToken]` to your home controller for a token-aware home.

---
## [5.0.0-beta.54] - 2026-06-05

- **[FIX]** `getConfig()` types in `genTypes.d.ts` are now inline **value-shape** types (value *types* like `string`, with arrays kept as **tuples**) instead of the `typeof import('./config/foo.ts').default` reference form introduced in beta.52. The reference form inferred array config elements as a union with `?: undefined` keys, which broke `Object.values()` over a config item (it widened to `any`) and could resolve to `any` outright on stricter/preview TypeScript (e.g. older `tsgo` builds) — a regression that surfaced only in CI for projects whose local type-checker differed. The value-shape form keeps `Object.values()` and per-element typing precise and is robust across compilers (it resolves no module), while still never serializing a literal config value into the generated file.

---
## [5.0.0-beta.53] - 2026-06-05

- **[NEW]** Codegen reads controllers without running their constructors. `generatetypes` now introspects each controller via a prototype-only "ghost" (`Object.create(Class.prototype)`) instead of `new Controller(app, prefix)`, so config reads, client construction, and other constructor side effects no longer fire during type generation. Runtime is unchanged — handlers still bind to real instances.
- **[DEPRECATED]** A controller whose `routes` getter reads **constructor-set state** is deprecated. Codegen transparently falls back to instantiating it (so nothing breaks) and emits a one-per-class `DeprecationWarning`, code `ASF_DEP_CTOR_ROUTES`. Make `routes` independent of constructor state; the instantiation fallback **will be removed in v6**.
- **[FIX]** Model-using CLI commands now wait for the MongoDB connection before running. Previously `#mongooseConnect()` was fire-and-forget, so a CLI command (`isShouldInitModels`) could fire its first query before the connection was established and rely on mongoose's buffer (default 10s `bufferTimeoutMS`) — causing intermittent "buffering timed out" failures on slow connects. Now `initAllModels({ waitForConnection: true })` (used only by model-using CLI commands) blocks until the connection is ready, with explicit progress logs (`Connecting to MongoDB…`, `MongoDB connection established in Nms`, `waiting … → ready after Nms`). Modelless commands (e.g. `generatetypes`) and the HTTP server are unaffected — the server stays lazy (requests buffer until ready).
---


## [5.0.0-beta.52] - 2026-06-04

- **[NEW]** Middleware request/query schemas can be declared **statically** — `static get relatedRequestParameters()` / `static get relatedQueryParameters()`. The framework reads them without instantiating the middleware (avoids constructor side effects during route setup / codegen). Framework middlewares (`Pagination`) migrated.
- **[DEPRECATED]** The **instance** form of those getters (`get relatedRequestParameters()` / `relatedQueryParameters` / `relatedReqParameters`) is deprecated and **will be removed in v6** — migrate to the static form. It still works (the framework detects the override, instantiates as a fallback, and emits a one-per-class `DeprecationWarning`, code `ASF_DEP_MW_INSTANCE_SCHEMA`).
- **[FIX]** `getConfig()` types in `genTypes.d.ts` are now emitted as references to each config module's type (`typeof import('./config/foo.ts').default`) instead of a serialized snapshot of the resolved runtime value. The old value-based approach had two real problems: env-only fields (e.g. `connectionString: process.env.MONGO_DSN`) **silently vanished** from the type when the env var was unset at gen time (`JSON.stringify` drops `undefined`), and populating the env var to keep them **baked the secret value into the committed file**. Reference-based types keep env-only fields (typed `string | undefined`), never serialize a value, and avoid over-narrow literal types (`port` is `string | number`, not `3300`). _(Superseded in beta.54 — see above.)_



---
## [5.0.0-beta.51] - 2026-05-31

- **[NEW]** `KeyValue` model: a minimal persistent key/value store backed by MongoDB for lightweight caching, runtime config, and feature flags.
- **[NEW]** `defineSchema<Output>(validate)` helper (`@adaptivestone/framework/services/validate/defineSchema.js`) — wrap a plain validate function into a zero-dependency Standard Schema. Codegen reads its `Output` generic for handler request types via `StandardSchemaV1.InferOutput`.
- **[NEW]** `File` type exported from `@adaptivestone/framework/types.js` — vendor-neutral uploaded-file type (aliases formidable's `PersistentFile` today; re-points at the web-standard `File` after the P3 parser swap). Validate uploads with your validator's idiom, e.g. `z.instanceof(File)`.
- **[NEW]** Content-type-keyed request schemas: a route's `request` can be a map (`{ 'application/json': schemaA, 'multipart/form-data': schemaB }`, mirrors OpenAPI `requestBody.content`). The framework validates with the schema matching the request's `Content-Type` (415 on no match) and `req.appInfo.request` becomes a `contentType`-discriminated union; codegen emits the union automatically. Media-type matching is case-insensitive and ignores parameters (`; charset=...`); `contentType` is a reserved field on the validated request object.
- **[CHANGE]** Built-in `Auth` controller and `Pagination` middleware now validate with `defineSchema` instead of yup. The framework runtime and built-ins are yup-free.
- **[BREAKING]** `yup` moved from `dependencies` to an optional `peerDependency`. It is no longer bundled. Apps that use yup schemas (including `YupFile`) must add `yup` to their own `dependencies`. Zod/Valibot/ArkType users are unaffected.
- **[BREAKING]** `@redis/client` v6. Now defaults to the RESP3 protocol (was RESP2) and requires a Redis ≥6 server; pass `createClient({ RESP: 2 })` to keep v5 wire behavior. Also adds a default 5s command timeout. <https://github.com/redis/node-redis/blob/master/docs/v5-to-v6.md>
- **[DEPRECATED]** `YupFile` (`@adaptivestone/framework/helpers/yup.js`) — removed in v6. Validate files via the new `File` export + your validator's `instanceof` idiom instead.

---
## [5.0.0-beta.50] - 2026-05-25

- **[FIX]** Tree-based router: different HTTP methods at the same param position can now use different `:name` segments. Previously, `PUT /:slug` and `POST /:event` on the same controller would either throw at boot ("conflicting param children") or silently use the first-registered name for all methods (`req.params.event` → `undefined`). Each `HandlerEntry` now carries its own `paramNames` array — the tree is structural only, param naming is per-handler.

---
## [5.0.0-beta.49] - 2026-05-18

- **[FIX]** Codegen: fix router name resolution in generated route types.
- **[UPDATE]** Codegen output improvements.

---
## [5.0.0-beta.48] - 2026-05-11

- **[NEW]** Codegen emits route metadata (`methodName`, `controllerClass`, `sourceFile`) on `HandlerEntry.meta`.
- **[NEW]** `Pagination` middleware declares `static get provides()` — routes with `Pagination` in their chain get `req.appInfo.pagination` typed automatically.
- **[NEW]** Codegen emits `appInfo.query` from route-level `query:` schemas.
- **[NEW]** Codegen deduplicates identical union branches.

---
## [5.0.0-beta.47] - 2026-05-11

- **[UPDATE]** Tree-based route type generation improvements.
- **[UPDATE]** Dependencies update.

---
## [5.0.0-beta.46] - 2026-05-11

- **[NEW]** Tree-based `RouteRegistry` replaces Express's hidden router internally. One global tree, walkable by codegen / OpenAPI / MCP emitters.
- **[NEW]** Per-controller route type generation (`npm run gen` emits `<File>.routes.gen.ts`).
- **[NEW]** Standard Schema validation (Yup ≥1.7, Zod, Valibot, ArkType supported).
- **[NEW]** Boot-time route tree log at `verbose` level.
- **[NEW]** Boot-time warnings on misconfigured routes / middleware Maps.
- **[NEW]** `app.controllerManager.registerController(ControllerClass, prefix?)` for explicit registration.
- **[FIX]** `setupVitest.ts` no longer imports framework-internal fixtures.
- **[FIX]** Codegen walks the `extends` chain when resolving middleware import paths.
- **[BREAKING]** Path-pattern syntax narrowed (no Express 5 optional-param `{:name}` or inline regex).
- **[BREAKING]** `AbstractController` constructor third argument `isExpressMergeParams` removed.
- **[BREAKING]** Legacy `{validate, cast}` plain-object validators removed.
- **[BREAKING]** Yup ≥1.7 required. Schemas must implement Standard Schema.
- **[BREAKING]** `ValidateService` surface trimmed. Helpers like `validateReqData` removed.
- **[BREAKING]** OpenAPI / documentation generation removed (will return later).

---
## [5.0.0-beta.45] - 2026-03-28
- **[BREAKING]** rate-limiter-flexible v9->v10
- **[BREAKING]** typecript v5->v6

---
## [5.0.0-beta.44] - 2026-02-22

- **[NEW]** Logout method
- **[Update]** set model typing



---
## [5.0.0-beta.43] - 2026-01-24

- **[FIX]** Fix typo in peerDeps


---
## [5.0.0-beta.42] - 2026-01-24

- **[BREAKING]** Mongoose v9. <https://mongoosejs.com/docs/migrating_to_9.html>.

---
## [5.0.0-beta.41] - 2026-01-17

- **[UPDATE]** Update deps
- **[NEW]** Bearer scheme support
- **[NEW]** redisConnection helper



---
## [5.0.0-beta.40] - 2025-12-15

- **[UPDATE]** Update `rate-limiter-flexible` to v9.
- **[UPDATE]** Remove 'winston-transport-sentry' and implementcustom logic based on 'sentry' itself (from v9.14 sentry have native winston support)


## [5.0.0-beta.39] - 2025-10-25

- **[UPDATE]**  rete limiter. Do not create index on mongo if we have "process.env.test === 'true'"

---

## [5.0.0-beta.38] - 2025-10-25

- **[UPDATE]**  update dependencies
- **[UPDATE]**  update rate limiter Mongo option to not create an index by default when NODE_ENV=test
- **[UPDATE]**  the default User model now uses roles and permissions with the String type (previously was any, for historical reasons). To avoid changes on Mongoose 8.19 as it affects User model https://github.com/Automattic/mongoose/issues/15699
- **[BREAKING]** Vitest v4 <https://vitest.dev/guide/migration.html#vitest-4>

---

## [5.0.0-beta.36] - 2025-08-24

- **[UPDATE]**  i18nService  update loading to avoid race conditions
---

## [5.0.0-beta.36] - 2025-08-24

- **[UPDATE]**  i18nService  update method names

---

## [5.0.0-beta.35] - 2025-08-24

- **[NEW]** Introduce i18nService (ability to user i18n not only inside middleware)

---

## [5.0.0-beta.34] - 2025-08-23

- **[NEW]** I18nMiddlewareAppInfo type

---

## [5.0.0-beta.33] - 2025-08-21

- **[NEW]** consumeResult changed to be more flexible

---

## [5.0.0-beta.32] - 2025-08-21

- **[NEW]** Ip detector middleware - add getIpAdressFromIncomingMessage function to allow user middleware as a detector of id adresses without middleware

---

## [5.0.0-beta.31] - 2025-08-21

- **[NEW]** Rate limiter middleware - add consumeResult function to allow user middleware as a regular rate limiter


---

## [5.0.0-beta.30] - 2025-08-01

- **[FIX]** Fix CLI mongo app name generation (64 symbols limit)


---

## [5.0.0-beta.29] - 2025-07-31

- **[FIX]** Fix CLI mongo app name generation (128 symbols limit)

---

## [5.0.0-beta.28] - 2025-07-29

- **[UPDATE]** Inside CLI allow to have a negative values
- **[UPDATE]** Update deps.

---

## [5.0.0-beta.27] - 2025-06-27

- **[UPDATE]** Remove eslint, prettiver and move to biome
- **[UPDATE]** Update types.
- **[UPDATE]** Update deps.


---

## [5.0.0-beta.26] - 2025-06-19

- **[UPDATE]** Update types.
- **[UPDATE]** Update tests (more ts).

---

## [5.0.0-beta.25] - 2025-06-17

- **[UPDATE]** Update types.

---

## [5.0.0-beta.24] - 2025-06-16

- **[UPDATE]** Update types.

---

## [5.0.0-beta.23] - 2025-06-16

- **[BREAKING]** No more global variables for testing and default user will not be created by default
- **[NEW]** Test helpers getTestServerURL, serverInstance, setDefaultUser, setDefaultAuthToken and createDefaultTestUser.

---

## [5.0.0-beta.22] - 2025-06-10

- **[UPDATE]** Update types.

---

## [5.0.0-beta.21] - 2025-06-09

- **[FIX]** Fix bug with missed model options.

---

## [5.0.0-beta.20] - 2025-06-09

- **[FIX]** Fix bug with `Lock` model index.
- **[NEW]** `BaseModel` add `Virtuals`.

---

## [5.0.0-beta.19] - 2025-06-08

- **[NEW]** Introducing new model type. `BaseModel`. Features - simplifie works with typescript. And based on statics.
- **[BREAKING]** All models now should be extended from `BaseModel`. This is a potential breaking change specially for `User` model.

---

## [5.0.0-beta.18] - 2025-06-08

- **[UPDATE]** Move away connection from `mongooseModels` to server itself (preparation for different model types).
- **[BREAKING]** potential. We are removed callback from `mongooseModels` contrctuctor. It was not used in code.
- **[NEW]** Add `appInstance` helper to access app instance from anywhere without passing it.

---

## [5.0.0-beta.17] - 2025-05-26

- **[NEW]** Add `GenerateTypes` command.

---

## [5.0.0-beta.16] - 2025-05-26

- **[UPDATE]** Update deps.
- **[UPDATE]** New app getter `internalFilesCache`.
- **[UPDATE]** Command new static props to load `isShouldGetModelPaths`.

---

## [5.0.0-beta.15] - 2025-04-24

- **[FIX]** Fix missing folder `migrations` in `dist` folder (hope that will be finally).

---

## [5.0.0-beta.14] - 2025-04-24

- **[FIX]** Fix missing folder `migrations` in `dist` folder.

---

## [5.0.0-beta.13] - 2025-04-23

- **[UPDATE]** Only process `.ts` or `.js` files (not `.map` files).

---

## [5.0.0-beta.12] - 2025-04-23

- **[BREAKING]** Remove jest support for testing.
- **[NEW]** Initial move to typescript. potentially breaking.
- **[NEW]** Introduce `src` and `dist` folders.

---

## [5.0.0-beta.11] - 2025-04-02

- **[NEW]** Commands typing.
- **[NEW]** Commands support TS files.
- **[UPDATE]** Update deps.

---

## [5.0.0-beta.9] - 2025-02-19

- **[BREAKING]** Move email module to separate package `@adaptivestone/framework-module-email`. Please use it if you want to send emails.
- **[NEW]** App now contains `frameworkFolder` folder the framework located. Mostly for modules usage.
- **[BREAKING]** Remove `VIEWS` folders at all. Should not afffect any user as this was not used internally.
- **[UPDATE]** Update typing.
- **[UPDATE]** Change `redis` -> `@redis/client` as we are using only client from pakage.
- **[BREAKING]** Removed `noidemailer-sendmail-transport`. Not needed anymore and not recommended to use as well.

---

## [5.0.0-beta.8] - 2025-02-16

- **[UPDATE]** Update deps.
- **[NEW]** `Lock` model for working locks via mongoDB.

---

## [5.0.0-beta.7] - 2025-02-09

- **[UPDATE]** Update deps.
- **[UPDATE]** Change `vitest` shutdown behavior as mongo driver v6.13 change befaviur that affect us (`MongoClient.close` now closes any outstanding cursors).

---

## [5.0.0-beta.5] - 2025-01-26

- **[BREAKING]** Remove `minimist` CLI parsing and replace it by `commandArguments` parser.
- **[UPDATE]** Migrated from `eslint-plugin-import` to `eslint-plugin-import-x`.
- **[UPDATE]** Migrate to eslint 9 and away from aibnb styles (they are abonded).

---

## [5.0.0-beta.4] - 2025-01-26

- **[NEW]** On shutdown event now after timeout we are forcing to shutdown.

---

## [5.0.0-beta.2] - 2025-01-26

- **[UPDATE]** Update deps.
- **[NEW]** Add ability to skip mongo model init in CLI env.
- **[NEW]** Now each mongo connection on CLI have own name and inslude command name there too (`getMongoConnectionName` in command).

---

## [5.0.0-beta.1] - 2025-01-21

- **[UPDATE]** Update deps.
- **[BREAKING]** `vitest` v3 <https://vitest.dev/guide/migration.html>.

---

## [5.0.0-alpha.26] - 2025-01-04

- **[UPDATE]** Update deps.
- **[UPDATE]** New commands view in CLI.

---

## [5.0.0-alpha.24] - 2024-11-22

- **[UPDATE]** Update deps.
- **[BREAKING]** `i18next` v24 <https://www.i18next.com/misc/migration-guide#v23.x.x-to-v24.0.0>.

---

## [5.0.0-alpha.23] - 2024-11-10

- **[UPDATE]** Update deps.

---

## [5.0.0-alpha.22] - 2024-10-29

- **[UPDATE]** Update deps.
- **[FIX]** Fix optional routing parameters.

---

## [5.0.0-alpha.21] - 2024-10-27

- **[BREAKING]** Possible breaking. Framework start using express 5 instead of express 4. Please follow express migration guide too <https://expressjs.com/en/guide/migrating-5.html>.
- **[BREAKING]** As part of express 5 migration `_` in rotes (middlewares) should have perameter. please replace `_` to `*splat`.
- **[UPDATE]** Update deps.
- **[UPDATE]** Mailer uses `await import()` for startup speedup.

---

## [5.0.0-alpha.20] - 2024-10-26

- **[UPDATE]** Update deps.
- **[UPDATE]** `#realLogger` do not throw error in a scecific cases (`model.toJSON({virtual:true})`).

---

## [5.0.0-alpha.19] - 2024-10-23

- **[NEW]** Added `modelSchemaOptions` for models.

---

## [5.0.0-alpha.18] - 2024-10-07

- **[BREAKING]** Default auth response changed to be unified. `{token, user}` => `{data:{token, user}}`.
- **[UPDATE]** `RateLimiter` updae key generation.

---

## [5.0.0-alpha.17] - 2024-10-05

- **[NEW]** `generateRandomBytes` command.
- **[UPDATE]** Update deps.

---

## [5.0.0-alpha.16] - 2024-10-02

- **[UPDATE]** No warning of direct usage `body` and `query`.
- **[UPDATE]** Update deps.

---

## [5.0.0-alpha.15] - 2024-09-26

- **[BUG]** Fix bug with pagination.
- **[UPDATE]** Update deps.

---

## [5.0.0-alpha.14] - 2024-09-23

- **[NEW]** Add types for `Abstract` model (wip).

---

## [5.0.0-alpha.13] - 2024-09-06

- **[UPDATE]** Update deps.
- **[UPDATE]** Update `i18n` internal implementation.
- **[CHANGE]** Disable https server view.

---

## [5.0.0-alpha.12] - 2024-09-04

- **[UPDATE]** Update deps.

---

## [5.0.0-alpha.11] - 2024-08-08

- **[UPDATE]** Update deps.

---

## [5.0.0-alpha.10] - 2024-07-29

- **[UPDATE]** Update deps.
- **[NEW]** `IpDetector` middleware that support detecting proxy and `X-Forwarded-For` header.
- **[BREAKING]** `RateLimiter` now need to have `IpDetector` middleware before.

---

## [5.0.0-alpha.9] - 2024-07-15

- **[UPDATE]** Update deps.
- **[BREAKING]** Removing `staticFiles` middleware as it not used in projects anymore. Docs with nginx config will be provided.
- **[BREAKING]** Remove default `AUTH_SALT`. It should be provided on a app level now.
- **[BREAKING]** Vitest 2.0.0 <https://vitest.dev/guide/migration.html#migrating-to-vitest-2-0>.

---

## [5.0.0-alpha.8] - 2024-05-10

- **[UPDATE]** Replace `dotenv` with `loadEnvFile`.
- **[UPDATE]** Replace `nodemon` with `node --watch` (dev only).
- **[BREAKING]** Minimum node version is 20.12 as for now (`process.loadEnvFile`).

---

## [5.0.0-alpha.7] - 2024-04-12

- **[UPDATE]** Deps update.

---

## [5.0.0-alpha.6] - 2024-03-03

- **[UPDATE]** Update internal documentation (`jsdoc`, `d.ts`).

---

## [5.0.0-alpha.5] - 2024-02-29

- **[UPDATE]** More verbose errors for rapsing body request.
- **[UPDATE]** Deps update.

---

## [5.0.0-alpha.4] - 2024-02-17

- **[UPDATE]** Update `rate-limiter-flexible` to v5.
- **[CHANGE]** Cache update `redis.setEX` to `redis.set(..,..,{EX:xx})` as `setEX` deprecated.

---

## [5.0.0-alpha.3] - 2024-02-14

- **[UPDATE]** Deps update.
- **[FIX]** `Migration` commands apply.

---

## [5.0.0-alpha.2] - 2024-01-25

- **[UPDATE]** Deps update.

---

## [5.0.0-alpha.1] - 2023-12-04

- **[BREAKING]** Vitest 1.0.0 <https://vitest.dev/guide/migration.html#migrating-from-vitest-0-34-6>.
- **[BREAKING]** ESM only. No more commonJS. That help to fix a lot of bugs with tests and provides better development expirience.
- **[BREAKING]** Mongoose v8. <https://mongoosejs.com/docs/migrating_to_8.html>.

---

## Older versions

Release notes for previous major versions are archived in separate files:

- [v4.x](./CHANGELOG_V4.md)
- [v3.x](./CHANGELOG_V3.md)
- [v2.x](./CHANGELOG_V2.md)
- [v1.x](./CHANGELOG_V1.md)
