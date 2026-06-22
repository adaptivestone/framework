# Framework Refactor

Status = directory. Move a file to change its status.

`done/` shipped · `active/` in flight · `queued/` next · `later/` v6 + far horizon

## Tracks & dependencies

```
v5 (done/) ──→ ┬──→ codegen track ──[AST front-end SHIPPED]──→ v6 cutover (later/)
               │    P1n AST replaced ghost+regex; v6 = drop skipWrap / boot-fallback
               │
               ├──→ docs / skill track ─────────────→ publish
               │    docs-sweep ✅ · doc additions ✅ · generator + llms.txt ← TODO
               │
               └──→ polish (independent) ───────────→ any order
                    rate-limiter-lazy · cache-drivers (memory)   [test-helpers ✅]

Blocking: docs-sweep (re-sweep) blocks the llm-skills generator
          v6 cutover blocked by all v5.1 active + queued work
          node-adapter blocked by v6
          drop-express blocked by node-adapter
```

## Index

### active/

| File | Ref | Summary |
|---|---|---|
| [docs-sweep](active/docs-sweep.md) | P1g | Audit `framework-documenation-github/docs/` against v5 behavior. Pass 1 ✅ (2026-06-06; recipes + anti-patterns chapters added). Re-sweep before publish; blocks llm-skills generator. ~½ d. |
| [llm-skills](active/llm-skills.md) | P1h | Doc additions ✅ (15-recipes, 16-anti-patterns). Still TODO: skill generator + `llms.txt` + `npx skills add` publish pipeline (no `skills/` dir or `llms.txt` in docs repo yet). Depends on docs-sweep. ~1.5 d. |

### queued/

| File | Ref | Summary |
|---|---|---|
| [cache-drivers](queued/cache-drivers.md) | P1c | **Make redis optional (cache half).** Memory-default driver + lazy redis driver — today `Cache` eager-connects to redis at boot, which is what makes redis required. Resolves #13, #10. Not started. |
| [rate-limiter-lazy](queued/rate-limiter-lazy.md) | P1b+ | **Make redis optional (rate-limiter half).** Lazy-load `@redis/client` in RateLimiter's redis driver only (memory/mongo never touch it). Coordinated with cache-drivers — the `@redis/client` optional-peer flip lands together. Not started. |
| [openapi-responses](queued/openapi-responses.md) | P2a-resp | 🎨 **Design needed.** Document real OpenAPI response bodies/schemas (today's are generic stubs). Success body must be declared (can't be inferred); errors/envelopes derivable from structure. Builds on [openapi-generator](done/openapi-generator.md). |

### later/

| File | Ref | Summary |
|---|---|---|
| [static-middleware-cutover](later/static-middleware-cutover.md) | P1f | v6: drop instance schema getters, remove `skipWrap` + `process.exit(0)` (= P1j Phase 5). v5.x bridge ✅ (P1j Phase 1). Note: the AST boot/ghost fallback was already deleted in v5.0.0 (P1n), so Phase 7 is partly done. |
| [observability](later/observability.md) | P2b | OTel, Sentry, metrics, healthz. |
| [performance](later/performance.md) | P2c | find-my-way, fast-json-stringify. |
| [mcp-surface](later/mcp-surface.md) | P2d | Full MCP server (read + write). Now unblocked — the `toJsonSchema` seam + registry walk shipped with [openapi-generator](done/openapi-generator.md). |
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
| [config-schema-codegen](done/config-schema-codegen.md) | P1l | `getConfig()` emits inline value-**shape** types (no literals, no secrets, no `import()`; arrays stay tuples). beta.54. |
| [codegen-ast](done/codegen-ast.md) | P1n | oxc AST codegen front-end — replaced ghost + regex (`importResolution.ts` + `ghostController.ts` **deleted**). Shipped v5.0.0; boot fallback removed → declarative controllers required. |
| [codegen-zero-init](done/codegen-zero-init.md) | P1j | Zero-init `npm run gen` (no controller/middleware/model `new`). Delivered via the AST front-end (P1n); Phases 0–3 ✅, Phase 4 moot. **Phase 5 (drop `skipWrap` + `process.exit(0)`) → v6** under [static-middleware-cutover](later/static-middleware-cutover.md). |
| [openapi-generator](done/openapi-generator.md) | P2a | OpenAPI 3.1 generator (`npm run openapi`) + vendor-neutral `toJsonSchema` driver seam (zod native, yup `describe()`, graceful placeholder). Runtime walk of `RouteRegistry.flatten()`. Unblocks MCP (P2d). 2026-06-20. |
| [test-helpers](done/test-helpers.md) | P1i | Runner-agnostic test setup (`setupFramework`); `setupVitest`/`globalSetupVitest` thin wrappers + new `setupNodeTest` → consumers can use `node:test`. vitest optional peer. Folded-in `createTestApp` utils NOT built. 2026-06-21. |

## v5.1 extras (no phase doc — tracked as bullets)

- `bodyParsing: 'parsed' | 'raw' | 'none'` modes + parser registry (`app.parsers`)
- `File` type export — ✅ shipped (beta.51)
- **Route-level multipart single-element extraction** — let a route declare which multipart fields are scalar; the router unwraps their single-element arrays **before** validation, so the schema stays the clean logical shape (`avatar: z.instanceof(File)`) and codegen reads that output type directly. Chosen over a schema-side `multipartScalar` helper (that wrapper was prototyped and dropped — it pushed a parser concern into the schema/types). Interim: validator-native `.array().length(1).transform(...)`. Revisits the parser-side `getFieldShape` idea from `decisions.md` → "Multipart parser is always-array" as an opt-in route convenience. Not scheduled.
- ✅ **Project boot hook (`bootHttp`)** — shipped 2026-06-22. **Explicit** `Server` constructor option `bootHttp(app)` (type `BootHttpHook`), called in `startServer` after controllers register, before the adapter mounts (type + call inlined in `server.ts` — no separate module). Explicit, NOT file-discovered — every framework folder is owned (config/ merges its files, controllers/ auto-loads its files), so there's no conflict-free folder to scan. HTTP-specific (needs `app.httpServer`). For ad-hoc routes (`registerRoute`) + Express middleware + boot setup. **`useGlobal`/global-middleware positioning still deferred** — lands in this same hook later (see [tree-router](done/tree-router.md) note).
- ✅ **`routes` CLI command** — shipped 2026-06-22. `node src/cli.ts routes` / `npm run routes` prints the route tree via `formatRouteTree` over a `skipWrap` registry build (the `openapi` command's pattern). `formatTree.ts` got its first unit test (0→96%).

## v6 breaking defaults (no phase doc — tracked as bullets)

- Strict Content-Type by default
- Case-sensitive + strict trailing-slash by default
- Awaitable `next()` middleware contract
- `YupFile.check` single-file semantics

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
