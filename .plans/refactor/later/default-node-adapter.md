# P4 — Default to `NodeAdapter`

**Status**: ⏸ deferred — **owner target (2026-11-01):** in v6 the Node adapter is the only HTTP
adapter; whether it becomes the default in a late 5.x minor is an open decision in
[v6-api-stability](../queued/v6-api-stability.md).
**Depends on**: P3
**Unblocks**: P5

## Goal (one-line)

Make `NodeAdapter` the default; deprecate `ExpressAdapter` (still buildable for one release). Tag/path filters in MCP server. Token-budget guardrails.

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §10.

## Out of scope until activated

Skip until P3 has been on `main` for at least one release.
