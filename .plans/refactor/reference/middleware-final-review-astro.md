# Final middleware and v6 stability review — Astro

**Date:** 2026-11-01.
**Reviewed:** `ccr-80ccfb40-0qs0lo` at `2b0777c8f4245d7003187a7446c055789bd772ae`.
**Scope:** [async-middleware](../queued/async-middleware.md),
[v6-api-stability](../queued/v6-api-stability.md), their contract checks and the accompanying
response-writer fix. Source line references below refer to this reviewed commit.
**Handoff:** published at the owner's request for implementation by Opus. This document records
review findings; it does not change the settled contract or implement the fixes.

## Verdict

The settled architecture matches the proposal. The separate `Middleware` base, mixed-route raw
error propagation, visible v5 `sent` kind, legacy terminal outcomes, execution order and stream
ownership rules are now clear. No architectural redesign is needed.

The plan is sufficient to start implementation once the scope conflict below is reconciled.
The guard and streaming findings need regression tests before their code is reused. The v6
acceptance criteria also need the additions below before the stability checklist is complete.

This supersedes the unresolved-status assessment in the
[previous review](middleware-contract-review-astro.md), while retaining that document as the
record of the earlier findings. Strict onion, the chosen context/state/cookie APIs, and the
future native-backend direction are not reopened.

## 1. [P1] Long streams retain completed cancellation races

**Location:** `src/services/http/ExpressResponseWriter.ts:277–292`, also the drain race at 309.

The accompanying writer fix races every source read against the same unresolved `closed`
promise. Each completed read leaves its race callbacks attached to that promise until
disconnect. This retains state in proportion to the number of chunks during a long-lived
response, including the planned SSE use case.

**Evidence:** a bounded probe of the actual writer emitted 64 chunks and blocked the 65th read.
Weak references to the handlers attached to `closed` showed all 128 callbacks from completed
reads still alive after garbage collection. After disconnect and writer settlement, none
remained. This demonstrates reaction retention; it is not a throughput or heap-size benchmark.

**Required change:** use removable cancellation waiters/listeners, releasing the waiter when
each read or drain completes. Preserve prompt settlement when the source is blocked and the
client disconnects. Add a test that repeated successful reads do not accumulate pending abort
waiters while the connection remains open.

The previous pending-read, synchronous cancellation-throw and replaced-source issues are
addressed by the writer changes; this is a regression in the cancellation mechanism.

## 2. [P2] Two guard edge cases still violate the documented contract

**Location:** `reference/middleware-experiments/contract-check.mjs:128–152` (under `.plans/refactor/`).

### Production: the direct forwarding shortcut does not expire its invocation

The `result === downstream && !dev` shortcut returns without ever setting the layer state to
settled. Reproduction:

1. An outer middleware awaits `next()`, then remains pending on an unrelated gate.
2. An inner middleware saves its `next` and returns `next()` directly.
3. The handler returns a 200 response, completing the inner invocation.
4. Call the saved `next()` again before releasing the outer gate, handling its rejection.

The production runner changes the final result to `next() called twice`; development refuses
the late call and preserves the 200. The contract requires an expired invocation's continuation
to be refused without changing the selected response.

**Required change:** expire the direct-forwarding path when its own result settles. Add this
case in both modes, distinguishing a duplicate call during an active invocation from a call
after that invocation completed.

### Development: diagnostic promises can reject before anyone observes them

The development branch returns a new promise from `result.then(...)` without immediately
observing rejection of that new promise. Reproduction:

1. An outer async middleware calls `next()` without returning or awaiting it, waits 30 ms,
   then returns a 202 response.
2. An inner async forwarding middleware returns `next()`.
3. The handler rejects before the outer delay ends.

Development emits `unhandledRejection`, followed by a late-handled-rejection warning when the
request finally settles. Production emits neither. Waiting for `req.started` at top-level
settlement is too late to satisfy the no-unhandled-rejection guarantee.

**Required change:** immediately observe rejection of every promise exposed by the guarded
continuation, including diagnostic wrappers, while preserving rejection for callers that await
it. Add the delayed-outer case to conformance in both modes.

## 3. [P2] Reconcile portable built-in migration timing

**Locations:** `queued/async-middleware.md:50–51,415–417` and
`queued/v6-api-stability.md:55` (under `.plans/refactor/`).

P1m keeps built-ins v1 throughout v5 and explicitly keeps global middleware on Express in v5.
The stability checklist requires portable app-wide built-ins before the Node adapter ships in
v5. Those instructions leave the prerequisite unowned or impossible to satisfy literally.

**Required change:** explicitly assign the app-wide API and portable built-in work before the
Node adapter. A compatible route is parallel portable implementations while preserving the
existing v1 classes and their subclass signatures until v6. Update the scope statements and
owning plan together; the middleware contract itself need not change.

## 4. [P2] Make v6 stability acceptance executable

**Locations:** `queued/v6-api-stability.md:32–37,63,94–96` and P1m's files/done-when lists.

- `createTestContext()` is assigned to 5.x P1m but absent from its files and acceptance criteria.
  Add its public module/export and a packed-consumer check. This supports the decision that
  applications use framework-created contexts rather than implementing the interface themselves.
- Adding a member to a closed response union can break exhaustive TypeScript consumers. The
  decision to allow new kinds in minors therefore needs a forward-compatible public representation
  and a consumer fixture proving supported narrowing/pass-through code still compiles after a
  new kind is added. Documenting pass-through alone does not demonstrate this guarantee.
- Replace the completion shortcut “implemented in its plan or explicitly decided” for required
  capabilities. Choosing a design is not completion of its implementation. Distinguish policy-only
  rows from required APIs, implementations and migration documentation.

These are acceptance and implementation-scope additions, not a request to reopen the owner's
decisions about response kinds, the Node adapter or removal of Express.

## Validation and limits

- Node `v26.12.1`: all **29 response-writer tests** passed with
  `node --test --test-timeout=10000 src/services/http/ExpressResponseWriter.test.ts`.
- `node .plans/refactor/reference/middleware-experiments/contract-review-probes.mjs`:
  all **six previous regression probes** passed.
- `node .plans/refactor/reference/middleware-experiments/contract-check.mjs conformance`:
  existing guarded cases passed. The real OpenTelemetry case was **skipped locally** because
  its optional experiment packages were unavailable; this review does not claim to rerun it.
- Additional bounded probes reproduced the two guard failures and the writer retention above.
- Node 24 and Bun results recorded by the prior implementation author were read but not rerun
  in this review. No full repository suite, type checks or packaging smoke run is claimed for
  this documentation-only handoff. The plan retains those gates for implementation.

No runtime code or settled plan decisions were changed by this review.
