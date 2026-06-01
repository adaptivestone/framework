# Framework Refactor

Status = directory. Move a file to change its status.

`done/` shipped · `active/` in flight · `queued/` next · `later/` v6 + far horizon

## Tracks & dependencies

```
v5 (done/) ──→ ┬──→ codegen track ─────────────────→ v6 cutover (later/)
               │    P1f bridge → ghost → lazy → skip
               │
               ├──→ docs / skill track ─────────────→ publish
               │    docs-sweep → doc additions → generator
               │
               └──→ polish (independent) ───────────→ any order
                    boot-log · rate-limiter · cache · test-helpers

Blocking: docs-sweep blocks llm-skills
          P1f v5.x bridge (codegen-zero-init Phase 1) blocks Phases 2-4
          v6 cutover blocked by all v5.1 active + queued work
          node-adapter blocked by v6
          drop-express blocked by node-adapter
```

## Index

### active/

| File | Ref | Summary |
|---|---|---|
| [codegen-zero-init](active/codegen-zero-init.md) | P1j | Kill controller/middleware/model `new` calls during `npm run gen`. Phase 0 ✅ (beta.49). Phases 1–4 v5.1; Phase 5 v6. ~2 d. |
| [llm-skills](active/llm-skills.md) | P1h | Generate Agent Skill from docs, ship via `npx skills add`. Cross-agent. Depends on docs-sweep. ~1.5 d. |

### queued/

| File | Ref | Summary |
|---|---|---|
| [docs-sweep](queued/docs-sweep.md) | P1g | Audit `framework-documenation-github/docs/` against v5 behavior. Blocks llm-skills. ~1 d. |
| [rate-limiter-lazy](queued/rate-limiter-lazy.md) | P1b+ | Lazy-import RateLimiter. Small. |
| [cache-drivers](queued/cache-drivers.md) | P1c | Cache driver abstraction. Small. |
| [test-helpers](queued/test-helpers.md) | P1i | Framework test helpers usable from `node:test` + vitest. ~½ d. |
| [codegen-incremental](queued/codegen-incremental.md) | P2a | File-based codegen cache + OpenAPI surface. TBD. |

### later/

| File | Ref | Summary |
|---|---|---|
| [static-middleware-cutover](later/static-middleware-cutover.md) | P1f | v6: drop instance schema getters, remove `skipWrap`. v5.x bridge in P1j Phase 1. |
| [observability](later/observability.md) | P2b | OTel, Sentry, metrics, healthz. |
| [performance](later/performance.md) | P2c | find-my-way, fast-json-stringify. |
| [mcp-surface](later/mcp-surface.md) | P2d | Full MCP server (read + write). |
| [node-adapter](later/node-adapter.md) | P3 | Drop Express router. Blocked by v6. |
| [default-node-adapter](later/default-node-adapter.md) | P4 | NodeAdapter as default. |
| [drop-express](later/drop-express.md) | P5 | Edge-compatible, Express gone. Blocked by P3+P4. |
| [mongo-er-diagram](later/mongo-er-diagram.md) | Side | Issue #11. |
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

## v5.1 extras (no phase doc — tracked as bullets)

- `bodyParsing: 'parsed' | 'raw' | 'none'` modes + parser registry (`app.parsers`)
- `File` type export — ✅ shipped (beta.51)
- **Route-level multipart single-element extraction** — let a route declare which multipart fields are scalar; the router unwraps their single-element arrays **before** validation, so the schema stays the clean logical shape (`avatar: z.instanceof(File)`) and codegen reads that output type directly. Chosen over a schema-side `multipartScalar` helper (that wrapper was prototyped and dropped — it pushed a parser concern into the schema/types). Interim: validator-native `.array().length(1).transform(...)`. Revisits the parser-side `getFieldShape` idea from `decisions.md` → "Multipart parser is always-array" as an opt-in route convenience. Not scheduled.
- Project-side boot hook (`bootHttp(app)` for ad-hoc routes / globals)
- `npm run cli routes` (registry walker for "what's mounted in my app")

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
