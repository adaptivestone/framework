# P1b+ — Route `params:` schema (validate + coerce path params)

**Status**: ⏸ queued (v5.1 — additive; see Open questions)
**Depends on**: P1b ✅ (tree router), P1a-runtime ✅ (Standard Schema dispatch)
**Origin**: 2026-06-23. Path params (`:id`) are the only request input the framework doesn't validate — `request:` validates the body, `query:` the query string, but params arrive as raw strings straight from the matcher (`ExpressAdapter` → `req.params`). A handler that passes a raw `:id` to Mongoose (`findById(req.params.id)`) throws a `CastError` (not a `ValidationError`), which surfaces as a **500**, not a clean 400. User confirmed params "can be anything" (ObjectId, numeric, date, slug) → coercion + arbitrary validation is wanted, so a narrow ObjectId helper is the wrong shape. Interim guidance shipped as a docs recipe (`15-recipes.md` "Validate an ObjectId" — in-handler guard) on 2026-06-23.

## Goal

Add an optional `params:` schema to the route object, validated + coerced the same way as `request:`/`query:`, exposing the typed result on `req.appInfo.params`. Completes the request-input triad (body / query / **params**).

## Design

- Route object gains `params?` — the same accepted type as `request`/`query` (any Standard Schema validator). Coercion comes from the validator itself (`z.coerce.number()`, yup casts).
- Validated + coerced output on **`req.appInfo.params`** (parallel to `.request` / `.query`). Raw `req.params` (Express-native strings) stays untouched → non-breaking.
- Failure → **400** with the standard `{ errors: { <name>: [...] } }` shape (same code path as body/query). A *valid-but-missing* id stays the handler's 404.
- **v1 scope: route-level only** — no middleware-provided param schemas (request/query collect middleware schemas; params don't, to keep it minimal).

## Files touched

- `src/modules/AbstractController.ts` — `RouteObject` type: add `params?`.
- `src/services/http/routing/RouteNode.ts` — `HandlerEntry`: add `params?` (+ `meta` already carries source info).
- `src/controllers/index.ts` — `buildHandlerEntry`: copy `obj.params` → `entry.params`; in the validation block (today ~419–446, where `req.appInfo.request` / `.query` are set) add a third branch validating `req.params` → `req.appInfo.params` via `ValidateService`, inside the same try/catch → 400.
- `src/services/http/types.ts` (`BaseRequestContext` / appInfo) — add an optional `params` slot.
- `src/codegen/` (routeTypes / collectMetadata) — emit `req.appInfo.params` typed as `InferOutput<paramsSchema>` in the per-handler `<Method>Request` alias. **The only genuinely new work** — the validation runtime is reused wholesale.
- Docs: flip the `15-recipes.md` "Validate an ObjectId" recipe from in-handler guard → declarative `params:`; update the `02-routes.md` Validation note (it currently says params are NOT validated).
- Tests: param validation pass/fail (400), coercion (string→number), typed-output codegen golden, and "existing gen unchanged when no `params:` declared".

## API change

```ts
// before — raw strings, unvalidated:
"/:id": { handler: this.getOne }            // req.params.id: string, no validation

// after — optional declarative validation + coercion:
"/:id": {
  handler: this.getOne,
  params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) }),
}
// req.appInfo.params.id typed + validated; a malformed id → 400 (not 500)
```

## Open questions

- **Output location**: `req.appInfo.params` (recommended — parallel, non-breaking) vs overwriting `req.params` (breaks the raw-string contract; would be a v6 change).
- **400 vs 404** on a malformed param: 400 recommended (it's a syntax error, consistent with request/query). Revisit if there's demand for 404.
- **Breaking?** Purely additive (optional field) → v5.1. Only the `req.appInfo.params` type addition touches codegen; gen output stays byte-identical for routes without a `params:` schema.

## Out of scope

- Middleware-provided param schemas (route-level only in v1).
- Path-embedded regex constraints (`/:id([0-9a-f]{24})`) — the framework deliberately narrowed path syntax to literals / `:name` / `{*name}`; not reintroducing inline regex.
- A coercion engine of our own — delegated to the validator (zod/yup/valibot/arktype).

## Done when

A route with a `params:` schema validates + coerces `req.params`; a malformed value → 400 with the standard error shape; `req.appInfo.params` is typed in the generated alias; gen output is unchanged for routes without `params:`. Recipe flipped to the declarative form; `02-routes` Validation note updated. Tests green.
