# P2a-responses — OpenAPI response contracts (P1q Phase 3)

**Status**: direction settled under [universal HTTP responses](universal-http-responses.md);
implementation not started. This file preserves the detailed OpenAPI questions and is subordinate
to P1q where the two documents overlap.
**Depends on**: [openapi-generator](../done/openapi-generator.md) ✅ and
[universal HTTP responses](universal-http-responses.md) Phases 1–2.
**Feeds**: a typed client / Swagger "try it"; later reuse by P2c response serialization
(`fast-json-stringify`) and codegen handler-return typing.
**Origin**: 2026-06-21 — the shipped generator emits generic `200/400/401/404` response stubs
with **no schemas**. "Can we document real response bodies?" → yes, but it needs a design call.

## Problem
Operations currently carry only `defaultResponses()` (status codes + text, no `content`/schema).
The **success body** (the DTO a handler returns) is undocumented, and the error/envelope
responses are generic text rather than real shapes.

## Core constraint
P1q adds explicit typed return descriptors, so OXC can syntactically recover the response kind,
literal status, media type, and body type expression. It still cannot semantically turn arbitrary
imported/generic TypeScript into JSON Schema. Therefore a `responses:` Standard-Schema map is
authoritative when present; known framework/non-JSON responses are derived; an unresolved body
type keeps its status/media type and emits a warning rather than a fabricated schema.

## Options (from the 2026-06-21 discussion)
| # | Option | Effort | Documents success body? |
|---|---|---|---|
| 0 | Keep stubs (do nothing) | none | no |
| 1 | **Auto-doc KNOWN responses from structure** — real `400` (validation payload) for validated routes, `401` for auth-middleware routes, `415` for content-type maps, pagination envelope where applicable. No new field. | low (framework-side, one-time) | no (errors/envelopes only) |
| 2 | **Declarative `responses:` on `RouteObject`** — status/content/schema contract through the `toJsonSchema` seam. Opt-in per route. | per-route authoring | yes |
| 3 | Parse `HttpResponse` return types | medium | status/media always; body only with a trustworthy resolver |
| 4 | **P1q hybrid** — typed return descriptors + structural responses + optional authoritative `responses:` schemas | medium + per-route | yes where declared/resolvable |

## Settled and remaining decisions
- **D1 — Add the field: settled yes**, named `responses:` because one handler can produce several
  statuses/media types. Structural enrichment also ships; neither is sufficient alone.
- **D2 — Shape: settled direction**, full `status → content-type → schema` with concise shorthands
  for a single JSON schema and empty response. Phase 0 locks the exact TypeScript syntax.
- **D3 — Runtime behavior: docs/types only in v5.2.** Optional output validation/serialization is
  later work and must be explicitly enabled; merely documenting a response cannot alter runtime.
- **D4 — Option 1 scope:** which known responses to emit, and verify each shape exists —
  the `ValidationError`/`issuesToPayload` 400 body, the auth 401 body, 415, pagination wrapper.
  Emit them as shared `components.responses`/`components.schemas` referenced from operations.
- **D5 — Reuse: settled direction.** `responses:` feeds OpenAPI and generated handler/client
  types. Its schema values may feed a future explicitly enabled P2c serializer, but v5.2 does not
  compile or validate outputs.
- **D6 — Error envelope as a shared component:** document the framework's standard validation
  -error payload once and `$ref` it everywhere, so routes don't repeat it.

## Settled direction
**Option 4**, delivered as P1q Phase 3. Typed descriptors are the runtime/controller API;
structural responses are free; `responses:` supplies exact body schemas where syntax-only return
types are insufficient. Runtime output validation/serialization remains separately opt-in.

## Files (sketch — exact set depends on the design)
- `src/services/documentation/OpenApiGenerator.ts` — replace `defaultResponses()` with a
  responses builder (structural for Option 1; reads `entry.response` for Option 2).
- P1q Phase 3: `src/modules/AbstractController.ts` (`RouteObject.responses?`),
  `src/services/http/routing/RouteNode.ts` (`HandlerEntry.responses`),
  `src/controllers/index.ts` (`buildHandlerEntry` threads it) — mirrors `request:` exactly.
- Tests (generator + driver), docs chapter.

## Out of scope
- AST scanning of handler control flow or thrown expressions. Only explicit response return types
  participate; semantic body inference requires a separately proven resolver.
- Runtime response validation/serialization (belongs to P2c; this card is docs-only).

## Done when
`npm run openapi` emits real response schemas for the agreed cases; full suite + `gen --check`
green; `responses:` is symmetric with `request:` and documented.
