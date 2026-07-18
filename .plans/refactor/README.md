# Framework Refactor

Status = directory. Move a file to change its status.

`done/` shipped · `active/` in flight · `queued/` next · `later/` v6 + far horizon

## Tracks & dependencies

```
v5 (done/) ──→ ┬──→ codegen track ──[AST front-end SHIPPED]──→ v6 cutover (later/)
               │    P1n AST replaced ghost+regex; v6 = drop skipWrap / boot-fallback
               │
               ├──→ docs / skill track ─────────────→ publish
               │    docs-sweep ✅ (re-swept 06-22) · doc additions ✅ · generator + llms.txt ← TODO
               │
               └──→ polish (independent) ───────────→ any order
                    [rate-limiter-lazy ✅] [cache-drivers ✅] [test-helpers ✅]

v5.2 (queued/) ─────→ universal HttpResponse + Express writer
                      └──→ OpenAPI response contracts ──→ v6 removes ordinary `res`

Blocking: docs-sweep re-sweep ✅ done → llm-skills generator now unblocked
          v6 cutover blocked by all v5.1 active + queued work
          node-adapter blocked by v6
          drop-express blocked by node-adapter
```

## Index

### active/

| File | Ref | Summary |
|---|---|---|
| [llm-skills](active/llm-skills.md) | P1h | Doc additions ✅ (15-recipes, 16-anti-patterns). Still TODO: skill generator + `llms.txt` + `npx skills add` publish pipeline (no `skills/` dir or `llms.txt` in docs repo yet). docs-sweep ✅ now unblocks this. Note: docs `npm run build` already regenerates `static/llm-context.md` via `scripts/generate-llm-context.js`. ~1.5 d. |
| [public-cluster-runner](active/public-cluster-runner.md) | P1r | **Implemented and verified; awaiting `[NEXT]` release.** Narrow public `runCluster` with fixed crash-loop safety, structured lifecycle events, signal forwarding, and shutdown timeout; framework/example entries and docs migrated; packed smoke green. |

### queued/

| File | Ref | Summary |
|---|---|---|
| [params-validation](queued/params-validation.md) | P1b+ | **Route `params:` schema.** Validate + coerce path params (`:id`) like `request:`/`query:`, typed on `req.appInfo.params`; malformed param → 400 (today: raw string → Mongoose `CastError` → 500). Additive, reuses the validation runtime; codegen typing is the only new work. Interim docs recipe shipped 2026-06-23. |
| [universal-http-responses](queued/universal-http-responses.md) | P1q | **v5.2 typed response bridge.** Returned JSON/text/empty/redirect/stream/file/native-Web response descriptors rendered by Express; thrown errors normalize to the same writer. Legacy `res` coexists in v5.2; ordinary controller `res` is removed in v6. Parent design for OpenAPI responses and the adapter-independent HTTP path. |
| [openapi-responses](queued/openapi-responses.md) | P2a-resp | **Response-contract/OpenAPI phase of P1q.** Merge typed handler outcomes with structural validation/middleware/error responses; optional Standard-Schema `responses:` map is authoritative for body schemas. Never fabricate schemas from syntax-only AST data. |
| [metrics-seam](queued/metrics-seam.md) | P1s | **Observability Phase 1 — metrics.** No-op-default metrics API plus automatic HTTP RED/runtime metrics, an optional Prometheus exporter, and `/metrics`; strict cardinality rules throughout. |
| [named-rate-limit-policies](queued/named-rate-limit-policies.md) | P1t | **Documentation/example only.** Put named option objects in consumer `config/rateLimiter.ts` and pass `policy.someName` directly; existing merge behavior and generated config types already provide the feature. |
| [http-engine-spike](queued/http-engine-spike.md) | Spike | **Native HTTP engine go/no-go.** Benchmark ladder in `benchmark/engines/`: Express baseline → `NodeAdapter` prototype (= P3 preview) → uWS → minimal Rust engine (napi vs UDS child-process, gated on uWS numbers). Pre-agreed thresholds; informs keep/skip P2c, P3 timing, and whether a native adapter joins the P3/P5 adapter family. Nothing ships. |

### later/

| File | Ref | Summary |
|---|---|---|
| [static-middleware-cutover](later/static-middleware-cutover.md) | P1f | v6: drop instance schema getters, remove `skipWrap` + `process.exit(0)` (= P1j Phase 5). v5.x bridge ✅ (P1j Phase 1). Note: the AST boot/ghost fallback was already deleted in v5.0.0 (P1n), so Phase 7 is partly done. |
| [async-middleware](later/async-middleware.md) | P1m | v6: **async/await middleware contract.** Drop Express's `next` callback — return → continue, `throw` → error, send response → stop. Collapses the adapter's Promise-bridge. Design call open (linear drop-`next` vs awaitable-`next` onion; A recommended). Best landed with static-middleware-cutover. |
| [observability](later/observability.md) | P2b | **Observability phases 2+.** OTel traces, log correlation, Sentry, health/readiness, diagnostics channels and profiling after the P1s metrics foundation. |
| [performance](later/performance.md) | P2c | find-my-way, fast-json-stringify. |
| [mcp-surface](later/mcp-surface.md) | P2d | Full MCP server (read + write). Now unblocked — the `toJsonSchema` seam + registry walk shipped with [openapi-generator](done/openapi-generator.md). |
| [jobs-module](later/jobs-module.md) | P2e | **Abstract durable jobs module + drivers.** At-least-once delivery state, bounded retry/backoff, dead letters, idempotency guidance, and P1s metrics. Redis/custom drivers stay optional; no silent no-op or memory fallback for durable queues. |
| [node-adapter](later/node-adapter.md) | P3 | Drop Express router. Blocked by v6. |
| [default-node-adapter](later/default-node-adapter.md) | P4 | NodeAdapter as default. |
| [drop-express](later/drop-express.md) | P5 | Edge-compatible, Express gone. Blocked by P3+P4. |
| [mongo-er-diagram](later/mongo-er-diagram.md) | Side | Issue #11. |
| [select-projection-typing](later/select-projection-typing.md) | Side | Type `.select(...)` results to the projected fields (typing track). Object-form first; fixture-gated. |
| [vitest-to-node-test](later/vitest-to-node-test.md) | Side | Replace vitest with `node:test`. Best slot: after v5.1. |

### done/

| File | Ref | Summary |
|---|---|---|
| [baseline](done/baseline.md) | P−1 | Perf pin 2026-05-03: plaintext 16591 req/s, realistic 15549 req/s. |
| [type-contracts](done/type-contracts.md) | P0 | `BaseRequestContext`, `ProvidesOf`, `UnionAppInfoProvides`. |
| [runtime-validators](done/runtime-validators.md) | P1a | Standard Schema dispatch, `ValidatorDriver`, `ValidationError`, auto-i18n. 132/132 tests. |
| [codegen-mvp](done/codegen-mvp.md) | P1a | Per-handler `<Method>Request` aliases via runtime introspection. 137/137 tests. Replaced by P1b codegen rewrite. |
| [tree-router](done/tree-router.md) | P1b | Tree-based `RouteRegistry`, `ExpressAdapter`, `ControllerManager`. +28% plaintext / +10% realistic. 211/211 tests. |
| [controller-migration](done/controller-migration.md) | P1d | Home + SomeController translated through the registry. |
| [boot-route-tree-log](done/boot-route-tree-log.md) | P1e | Boot-time project-wide route tree log from `RouteRegistry` (`formatTree.ts`, verbose level). |
| [yup-optional](done/yup-optional.md) | P1k | yup un-bundled: `defineSchema` + `File` export (optional peer); `YupFile` deprecated; content-type-keyed request schemas. beta.51. |
| [mongoose-validation-safety-net](done/mongoose-validation-safety-net.md) | P1o | **Escaped Mongoose `ValidationError` → 400** when ALL failing model paths match `req.appInfo.request`/`query` keys (first segment, minus `contentType`); any renamed/internal path → 500 stays (never leak model paths); warn/error log split. Shipped 2026-07-05 (905b217), v5.1 behavior change. Superseded plumbing-wise by P1p (net now a registry built-in; semantics unchanged). |
| [error-handler-registry](done/error-handler-registry.md) | P1p | **Typed HTTP errors + extensible error→response registry.** `HttpError` + 5 subclasses (`services/http/httpErrors.ts`); `httpServer.registerErrorHandler(ErrorClass, fn, {logLevel?})` → unregister fn; consumer tier before built-ins (HttpError mapper verbose + P1o net warn), first non-null wins, handler-throw aborts → 500. Catch block = headersSent → registry walk → 500. Implemented 2026-07-05 ([impl plan](done/error-handler-registry-implementation.md)); docs chapter 06-Controllers/04-error-handling written (docs repo, uncommitted). Additive, v5.1. |
| [config-schema-codegen](done/config-schema-codegen.md) | P1l | `getConfig()` emits inline value-**shape** types (no literals, no secrets, no `import()`; arrays stay tuples). beta.54. |
| [codegen-ast](done/codegen-ast.md) | P1n | oxc AST codegen front-end — replaced ghost + regex (`importResolution.ts` + `ghostController.ts` **deleted**). Shipped v5.0.0; boot fallback removed → declarative controllers required. |
| [codegen-zero-init](done/codegen-zero-init.md) | P1j | Zero-init `npm run gen` (no controller/middleware/model `new`). Delivered via the AST front-end (P1n); Phases 0–3 ✅, Phase 4 moot. **Phase 5 (drop `skipWrap` + `process.exit(0)`) → v6** under [static-middleware-cutover](later/static-middleware-cutover.md). |
| [openapi-generator](done/openapi-generator.md) | P2a | OpenAPI 3.1 generator (`npm run openapi`) + vendor-neutral `toJsonSchema` driver seam (zod native, yup `describe()`, graceful placeholder). Runtime walk of `RouteRegistry.flatten()`. Unblocks MCP (P2d). 2026-06-20. |
| [test-helpers](done/test-helpers.md) | P1i | Runner-agnostic test setup (`setupFramework`); `setupVitest`/`globalSetupVitest` thin wrappers + new `setupNodeTest` → consumers can use `node:test`. vitest optional peer. Folded-in `createTestApp` utils NOT built. 2026-06-21. |
| [cache-drivers](done/cache-drivers.md) | P1c | **Make redis optional (cache half).** `CacheDriver` interface + memory-default driver + lazy redis driver; `config/cache.ts`; zero-TTL skip (#10, #13). Default cache backend is now in-memory. 2026-06-22. |
| [rate-limiter-lazy](done/rate-limiter-lazy.md) | P1b+ | **Make redis optional (rate-limiter half).** RateLimiter redis driver lazy-`import()`s `@redis/client` (deferred `whenReady`, non-blocking sync client); memory/mongo never touch it. `@redis/client` flipped to an optional peer with cache-drivers. 2026-06-22. |
| [docs-sweep](done/docs-sweep.md) | P1g | Audit the documentation repository against v5 behavior. Pass 1 ✅ (2026-06-06) + Pass 2 re-sweep ✅ (2026-06-22, 18 chapters, 5 audit agents). Build green (`onBrokenLinks: throw`). Unblocks llm-skills. |

## v5.1 extras (no phase doc — tracked as bullets)

- `bodyParsing: 'parsed' | 'raw' | 'none'` modes + parser registry (`app.parsers`)
- `File` type export — ✅ shipped (beta.51)
- **Route-level multipart single-element extraction** — let a route declare which multipart fields are scalar; the router unwraps their single-element arrays **before** validation, so the schema stays the clean logical shape (`avatar: z.instanceof(File)`) and codegen reads that output type directly. Chosen over a schema-side `multipartScalar` helper (that wrapper was prototyped and dropped — it pushed a parser concern into the schema/types). Interim: validator-native `.array().length(1).transform(...)`. Revisits the parser-side `getFieldShape` idea from `decisions.md` → "Multipart parser is always-array" as an opt-in route convenience. Not scheduled.
- ✅ **Project boot hook (`bootHttp`)** — shipped 2026-06-22. **Explicit** `Server` constructor option `bootHttp(app)` (type `BootHttpHook`), called in `startServer` after controllers register, before the adapter mounts (type + call inlined in `server.ts` — no separate module). Explicit, NOT file-discovered — every framework folder is owned (config/ merges its files, controllers/ auto-loads its files), so there's no conflict-free folder to scan. HTTP-specific (needs `app.httpServer`). For ad-hoc routes (`registerRoute`) + Express middleware + boot setup. **`useGlobal`/global-middleware positioning still deferred** — lands in this same hook later (see [tree-router](done/tree-router.md) note).
- ✅ **`routes` CLI command** — shipped 2026-06-22. `node src/cli.ts routes` / `npm run routes` prints the route tree via `formatRouteTree` over a `skipWrap` registry build (the `openapi` command's pattern). `formatTree.ts` got its first unit test (0→96%).

## v5.2 target

- [Universal typed HTTP responses](queued/universal-http-responses.md) — additive returned-response algebra + Express writer; JSON/text/empty/redirect/stream/file/native Web response; throwable errors preserved; legacy `res` coexists.
- [OpenAPI response contracts](queued/openapi-responses.md) — typed handler outcomes plus structural validation/middleware/error responses and optional authoritative Standard-Schema body contracts.
- [Typed rate-limit policies](queued/named-rate-limit-policies.md) require only a documentation/example recipe, not a framework release.
- The [public cluster runner](active/public-cluster-runner.md) is an independent additive v5.2.x candidate.
- [Observability Phase 1 — metrics](queued/metrics-seam.md) ships the core metrics seam independently, then uses P1q's response writer for automatic HTTP response status/size measurements.

## v6 breaking defaults (no phase doc — tracked as bullets)

- Ordinary controllers and registry middleware no longer receive `res`; they return `HttpResponse | void`. Native Web response pass-through and explicitly adapter-specific raw routes remain. See [P1q](queued/universal-http-responses.md).
- Strict Content-Type by default
- Case-sensitive + strict trailing-slash by default
- `YupFile.check` single-file semantics

(Async/await middleware contract — formerly a bullet here — now has its own card: [async-middleware](later/async-middleware.md), P1m.)

## Conventions

- **Each phase doc fits on one screen** when collapsed. Goal, files, API, test plan, out-of-scope, done.
- **Out-of-scope lists are mandatory.** "What's NOT in this phase" prevents scope-creep panic.
- **Files touched is exhaustive.** If a phase modifies a file not listed, that's a bug in the plan.
- **Done when is verifiable in under 5 minutes.** Not "feature complete"; specific commands or observations.

## Reference

- [Prior art](./reference/prior-art.md) — Hono internals, TanStack Router codegen, Standard Schema, Encore.ts, OTel HTTP semconv
- [Decisions](./reference/decisions.md) — settled architectural choices
- [Open questions](./reference/open-questions.md) — unresolved trade-offs
- [Glossary](./reference/glossary.md) — `RouteNode`, `HandlerEntry`, `MiddlewareEntry`, `RouteRegistry`, etc.

## Archive

- [`_archive/REFACTOR_PLAN_v1.md`](./_archive/REFACTOR_PLAN_v1.md) — the original synthesis doc
