# P2a (OpenAPI) — OpenAPI 3.1 generator

**Status**: ✅ DONE (2026-06-20). The OpenAPI piece of the old P2a card — it shipped on its own. The rest of that card was retired 2026-06-21: the incremental cache is parked in [performance](../later/performance.md) (obviated by the AST migration) and the testing utils folded into [test-helpers](../queued/test-helpers.md).
**Depends on**: P1a-runtime (driver seam) ✅, P1b (RouteRegistry) ✅
**Unblocks**: [mcp-surface](../later/mcp-surface.md) (P2d) — the `toJsonSchema` driver seam it needs now exists.

## Goal

Emit an OpenAPI 3.1 document from the route registry. Replaces the deleted yup-shaped
`DocumentationGenerator` (git `c8d665c`) with a vendor-neutral generator driven by the
validator driver seam.

## Why runtime, not AST (one source of truth)

JSON Schema can only be produced from **live schema objects** (`z.toJSONSchema`,
`yup.describe()`); the AST front-end sees only type references, and inline schemas have no
importable binding. So OpenAPI loads controllers once (`skipWrap` — no middleware
instantiation, no mongo, no port) and walks **the same `RouteRegistry.flatten()` codegen
models**. One route model, two readers: codegen reads it statically (fast, hot path);
OpenAPI reads it at runtime (cold, rare). The schema → JSON Schema projection is the
`toJsonSchema` driver seam, reused by MCP next — nothing here is throwaway.

## What shipped

- **`src/services/documentation/OpenApiGenerator.ts`** — pure `generateOpenApi(routes, opts)`
  → OpenAPI 3.1 doc. Path `:id`→`{id}`, splat approximated to a `{param}` + warning; path +
  query params; request body from single schema or content-type map (native multipart);
  middleware-contributed request/query schemas merged; security from middleware static
  `usedAuthParameters`; tags + operationId from route `meta`. Graceful placeholder + warning
  when a schema can't be introspected.
- **`src/commands/OpenApi.ts`** — `openapi` CLI command (`npm run openapi [-- --output f.json]`).
  `isShouldInitModels=false`; builds a bare `RouteRegistry` + `ControllerManager.initControllers({skipWrap})`
  (no `HttpServer` — its ctor binds a port). Info from package.json, servers from http config.
- **Driver `toJsonSchema` seam** (the reusable core): `types.ts` widened to allow async;
  `YupDriver` hand-rolls from `describe()`; `StandardSchemaDriver` is generic — native
  `.toJsonSchema()` method → zod `z.toJSONSchema` (lazy import) → null. Vendors without
  introspection (e.g. `defineSchema`, valibot) degrade to a placeholder.
- **Route meta threading** — `HandlerEntry.meta` gained `description` + `controllerClass`
  (populated in `controllers/index.ts`); codegen output unchanged (verified `gen --check`).
- **Security marker** — `static get usedAuthParameters()` on `AbstractMiddleware` +
  `GetUserByToken` (read with zero instantiation).

## Done when (verified)
- `npm run openapi` over the framework's own controllers → valid 3.1 doc (paths,
  `components.securitySchemes` from auth middleware, tags). ✅ (defineSchema bodies correctly
  degrade to placeholders + warnings.)
- Unit tests: `OpenApiGenerator.test.ts` (9), driver tests (10), `OpenApiGenerator.integration.test.ts`
  (1, real ControllerManager registry). Full suite green; tsc + biome clean; `gen --check` clean.

## Out of scope (re-homed when the P2a card was retired)
- Incremental codegen cache — parked in [performance](../later/performance.md) (obviated by the AST migration).
- `createTestApp` / testing utilities — folded into [test-helpers](../queued/test-helpers.md) (P1i).
- Per-vendor valibot/arktype peers beyond the generic seam (added if/when needed).
