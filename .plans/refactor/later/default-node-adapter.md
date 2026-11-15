# P4 — Default to `NodeAdapter`

**Status**: ⏸ deferred — **owner target (2026-11-01):** in v6 the Node adapter is the only HTTP
adapter; **decided 2026-11-01:** it ships as an
opt-in in 5.x and becomes the default in a later 5.x minor, after one release as an option; Express
stays a deprecated opt-in until v6 ([v6-api-stability](../queued/v6-api-stability.md) decision 1).
**Depends on**: P3
**Unblocks**: P5

## Goal (one-line)

Make `NodeAdapter` the default; deprecate `ExpressAdapter` (still buildable for one release). Tag/path filters in MCP server. Token-budget guardrails.

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §10.

## Out of scope until activated

Skip until P3 has been on `main` for at least one release.
