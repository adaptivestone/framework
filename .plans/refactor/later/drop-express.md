# P5 — Edge / drop Express

**Status**: ⏸ deferred
**Depends on**: P4
**Unblocks**: nothing — terminal phase

## Goal (one-line)

Drop `express` dep entirely. The canonical handler contract remains `(ctx) => HttpResponse` from
P1q; Fetch-style adapters render it to Web `Response`, and `HttpResponse.native(Response)` remains
the portable pass-through. Native `BunAdapter` and `DenoAdapter` ship; ordinary Bun runtime
support through the existing Express adapter ships much earlier as an
[immediate stable-fix-gated v5.x patch](../queued/bun-runtime-support.md). Cloudflare Containers adapter.
Sub-MCP servers per Mongoose model. Tool-quality lint + eval harness.

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §10.

## Out of scope until activated

Skip until P4 stable. Mongoose-on-edge constraint means full Workers (no-Containers) isn't a Phase 5 target — defer to P6+ pending Drizzle adapter or similar.
