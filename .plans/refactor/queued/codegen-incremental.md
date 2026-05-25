# P2a — Codegen incremental + testing utils + OpenAPI generator

**Status**: ⏸ deferred
**Depends on**: P1a-codegen, P1b
**Unblocks**: P2d (MCP consumes OpenAPI generator output)

## Goal (one-line)

Make codegen incremental (dep graph + cache); ship `createTestApp` + `routeRegistry.register` + `middleware.replace` testing utilities; replace `DocumentationGenerator.js` with `OpenApiGenerator` driven by the codegen artefacts.

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §5 ("Codegen design — Incremental updates") and §7a-b for full design. Stubbed here until initial scope ships.

### Prior OpenAPI emit reference

The old `DocumentationGenerator` + `getOpenApiJson` CLI was deleted before this phase started (yup-`.fields`-shaped, broken after Standard Schema migration). Reusable bits — OpenAPI 3.0 doc skeleton, path-param `:id` → `{id}` extraction, tags from controller name, securitySchemes from middleware `authParams`, multipart detection — are preserved in git history at commit `c8d665c` (`src/services/documentation/DocumentationGenerator.js`, `src/commands/Documentation.js`, `src/commands/GetOpenApiJson.js`). Crib from there; do not restore as live code.

## Out of scope until activated

Skip until all initial-scope phases are ✅. Don't draft this card further until then.
