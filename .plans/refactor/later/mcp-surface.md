# P2d — LLM/MCP surface

**Status**: ⏸ deferred
**Depends on**: P2a (OpenAPI generator), P1a-codegen
**Unblocks**: nothing critical

## Goal (one-line)

`app.toMcpServer({ transport })` derives MCP tools from the `RouteRegistry` (and the per-controller `*.routes.gen.d.ts` artefacts); three meta-tools (`list_endpoints`, `get_endpoint_schema`, `invoke_endpoint`) handle the >40-tool ceiling; deny-by-default authz model with `static authMiddleware = true` enforcement; errors-as-instructions formatter; non-interactive `framework add ...` CLI; `Model.toMcpResource()`; Vercel AI SDK adapter.

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §9.

## Out of scope until activated

Skip until P2a's OpenAPI generator is stable. The MCP tool schemas piggy-back on the same JSON-Schema introspection.
