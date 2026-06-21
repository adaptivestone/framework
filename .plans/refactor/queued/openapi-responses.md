# P2a-responses — OpenAPI response bodies/schemas

**Status**: 🎨 DESIGN NEEDED — not started. Options mapped (2026-06-21); the shape/scope
decisions below must be settled before implementing.
**Depends on**: [openapi-generator](../done/openapi-generator.md) ✅ (the `toJsonSchema` driver
seam + the generator's `buildRequestBody`/responses assembly to mirror).
**Feeds**: a typed client / Swagger "try it"; later reuse by P2c response serialization
(`fast-json-stringify`) and codegen handler-return typing.
**Origin**: 2026-06-21 — the shipped generator emits generic `200/400/401/404` response stubs
with **no schemas**. "Can we document real response bodies?" → yes, but it needs a design call.

## Problem
Operations currently carry only `defaultResponses()` (status codes + text, no `content`/schema).
The **success body** (the DTO a handler returns) is undocumented, and the error/envelope
responses are generic text rather than real shapes.

## Core constraint (why the success body can't be auto-inferred)
A response has **no runtime schema object** (unlike `request`/`query`, which are validated).
Inferring the shape from the handler's **return type** would need the TypeScript type-checker —
but codegen is oxc (syntactic only) and TS 7 drops the compiler API; it's also shape-only
(loses constraints). So the success body must be **declared**, or left undocumented. Everything
*else* (errors, envelopes) the framework can derive from route structure.

## Options (from the 2026-06-21 discussion)
| # | Option | Effort | Documents success body? |
|---|---|---|---|
| 0 | Keep stubs (do nothing) | none | no |
| 1 | **Auto-doc KNOWN responses from structure** — real `400` (validation payload) for validated routes, `401` for auth-middleware routes, `415` for content-type maps, pagination envelope where applicable. No new field. | low (framework-side, one-time) | no (errors/envelopes only) |
| 2 | **Declarative `response:` on `RouteObject`** — author a schema; run through the `toJsonSchema` seam. Opt-in per route. | per-route authoring | yes |
| 3 | Infer from handler return type | — | ruled out (TS-checker/oxc/TS7, shape-only) |
| 4 | **Hybrid 1 + 2** — free structural error/envelope docs everywhere + opt-in `response:` for success bodies | low + per-route | yes (where declared) |

## Design — open questions (resolve first)
- **D1 — Appetite:** do we add the `response:` field at all (Option 2/4), or ship only the
  structural enrichment (Option 1), or nothing (0)? Decide by *who consumes the spec* (typed
  client / Swagger "try it" ⇒ need success bodies; discovery/validation/auth ⇒ Option 0/1 is enough).
- **D2 — Shape (if `response:`):** single success schema · status-code map (+ bare-schema
  shorthand for 200) · full `status → content-type → schema`. (Mirror `request:`'s
  `StandardSchemaV1 | RequestContentTypeMap` for symmetry.)
- **D3 — Runtime behavior:** docs-only metadata (recommended, non-breaking, like the
  `bodyParsing` reserved modes) vs opt-in validate/serialize responses (riskier; can 500 valid
  responses; perf cost).
- **D4 — Option 1 scope:** which known responses to emit, and verify each shape exists —
  the `ValidationError`/`issuesToPayload` 400 body, the auth 401 body, 415, pagination wrapper.
  Emit them as shared `components.responses`/`components.schemas` referenced from operations.
- **D5 — Reuse:** should `response:` also type the handler's **return** (codegen) and/or feed
  **P2c** response serialization? If yes, the shape chosen in D2 must serve all three consumers
  — decide now so the field isn't reshaped later.
- **D6 — Error envelope as a shared component:** document the framework's standard validation
  -error payload once and `$ref` it everywhere, so routes don't repeat it.

## Recommended direction (pending the design call)
**Option 1 first** — free structural enrichment, zero new API surface, immediate value — then
add **Option 2** opt-in (→ Hybrid 4) only when a concrete typed-client/Swagger consumer needs
success-body schemas. Keep runtime **docs-only** in all cases.

## Files (sketch — exact set depends on the design)
- `src/services/documentation/OpenApiGenerator.ts` — replace `defaultResponses()` with a
  responses builder (structural for Option 1; reads `entry.response` for Option 2).
- *(Option 2 only)* `src/modules/AbstractController.ts` (`RouteObject.response?`),
  `src/services/http/routing/RouteNode.ts` (`HandlerEntry.response`),
  `src/controllers/index.ts` (`buildHandlerEntry` threads it) — mirrors `request:` exactly.
- Tests (generator + driver), docs chapter.

## Out of scope
- Return-type inference (D3 ruled out).
- Runtime response validation/serialization (belongs to P2c; this card is docs-only).

## Done when (to be finalized after design)
`npm run openapi` emits real response schemas for the agreed cases; full suite + `gen --check`
green; the chosen field (if any) is symmetric with `request:` and documented.
