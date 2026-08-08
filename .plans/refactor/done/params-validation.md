# P1b+ — Route `params:` schema (validate + coerce path params)

**Status**: ✅ **implemented 2026-08-07** · unreleased (in the 5.2.3/5.3.0 changelog)
**Target**: additive; shipped alongside a behavior-change floor (see below)
**Depends on**: P1b ✅ (tree router), P1a-runtime ✅ (Standard Schema dispatch)
**Origin**: 2026-06-23. Path params (`:id`) were the only request input the framework didn't validate — `request:` validates the body, `query:` the query string, but params arrived as raw strings straight from the matcher (`ExpressAdapter` → `req.params`). A handler passing a raw `:id` to Mongoose (`findById(req.params.id)`) threw a `CastError` (not a `ValidationError`), which surfaced as a **500**. Confirmed empirically before implementation: `GET /person/abc` → `500 {"message":"Platform error…"}`.

## Delivered behavior

**1. Route `params:` schema (as planned).** Any Standard Schema validator; validated before the handler; failure → **400** with the standard `{ errors: { <param>: [...] } }`. Validated + coerced output on `req.appInfo.params`; raw `req.params` untouched (Express string contract). Route-level only — middleware contribute body/query schemas, never param schemas.

```ts
'/person/:id': {
  handler: this.getOne,
  params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) }),
}
```

**2. Standalone `CastError` floor (NOT in the original plan).** A `CastError` is a *sibling* of `ValidationError`, not a subclass, so the P1o safety net structurally could not see it — and its failing path is an internal model field (`_id`) that must never be echoed. A third built-in registry entry now resolves it: when the rejected value is one the client actually supplied (matched by value against path params ∪ validated body ∪ query), it becomes a **400** keyed by that public input name, logged at `warn`. A cast failure on a server-computed value matches nothing and keeps its honest **500** at `error`. Message rebuilt from the cast `kind`; `toLoggableError` sanitizes standalone `CastError`s too, since a path param can carry PII.

*Why it was added:* `params:` alone is opt-in — a route without a schema still 500'd. The floor makes the default correct.

**3. OpenAPI path-parameter typing (NOT in the original plan).** Path params were emitted from the URL pattern alone as `schema: { type: 'string' }`. A declared `params:` schema now types them through the same `toJsonSchema` driver seam used for `request:`/`query:`. `required` stays `true` regardless of schema optionality (a path param is part of the URL; OpenAPI 3.1 forbids an optional one). Omitted params and un-introspectable schemas degrade to `string`. A `params:` key with no matching path segment warns — it can never be populated.

## Files touched

- `src/modules/AbstractController.ts` — `RouteObject.params?`
- `src/services/http/routing/RouteNode.ts` — `HandlerEntry.params?`
- `src/controllers/index.ts` — `buildHandlerEntry` copy; params validated **first** in `#wrapHandlerEntry`
- `src/services/http/types.ts`, `HttpServer.ts`, `middleware/PrepareAppInfo.ts` — `appInfo.params` slot, seeded `{}`
- `src/services/http/builtinErrorHandlers.ts` — `matchedClientCastError` + third built-in + `toLoggableError` branch
- `src/codegen/astExtract.ts` (`hasParams`, shared `isNullishLiteral`), `astEmit.ts`, `collectMetadata.ts`, `emit.ts`
- `src/services/documentation/OpenApiGenerator.ts` — `buildPathParameters`
- Tests: `controllers/index.test.ts` (+7), `builtinErrorHandlers.test.ts` (+7), `astExtract.test.ts` (+1), `OpenApiGenerator.test.ts` (+3), `OpenApiGenerator.integration.test.ts`, new fixture `tests/fixtures/controllers/ParamsController.ts`
- Docs: `02-routes.md` (new Params section, route-object reference, codegen table), `04-error-handling.md` (cast safety net), `15-recipes.md` (ObjectId recipe flipped to declarative), `17-openapi.md`

## Decisions made during implementation

- **Output location: `req.appInfo.params`**, not overwriting `req.params`. Considered and rejected: overwriting is one source of truth but breaks the Express string contract and would be a v6 break. Accepted cost — raw `req.params` stays a live footgun until v6.
- **Params validate before body/query.** A malformed `:id` means the request targets nothing coherent, so it should decide the 400.
- **Cast floor matches by VALUE, not by path.** The model path is internal; the client-supplied input name is public.

## Out of scope (unchanged)

Middleware-provided param schemas · path-embedded regex (`/:id([0-9a-f]{24})`) · a framework coercion engine (delegated to the validator).

## Done when — ✅ all met

724 tests / 722 pass (2 Redis-env), `tsc` 0, biome clean, docs build green with `onBrokenLinks: throw`. Move to `done/` when the release ships.
