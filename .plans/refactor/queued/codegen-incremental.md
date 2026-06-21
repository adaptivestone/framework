# P2a — Codegen incremental + testing utils

**Status**: ⏸ deferred
**Depends on**: P1a-codegen, P1b
**Note**: The **OpenAPI generator** that used to live in this card has shipped — see
[done/openapi-generator.md](../done/openapi-generator.md). What remains here is the
incremental cache + testing utilities.

## Goal (one-line)

Make codegen incremental (dep graph + cache); ship `createTestApp` + `routeRegistry.register`
+ `middleware.replace` testing utilities.

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §5 ("Codegen design — Incremental updates") and §7b. Stubbed
here until activated.

**Reality check (2026-06-20):** the incremental-cache value dropped sharply after the AST
migration (P1n) — codegen no longer boots, so a full run is already near-instant. Its whole
premise was avoiding repeated slow boots. Revisit only if a very large consumer project shows
a watch-mode pain point. The testing-utils piece overlaps [test-helpers](./test-helpers.md) (P1i).

## Out of scope until activated

Don't draft this card further until there's a concrete trigger.
