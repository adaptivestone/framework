# Middleware v2 — final recommendation

**Date:** 2026-11-01. **Status:** **decided 2026-11-01 — strict onion** (owner). Outcomes of the other decisions in §9;
they are recorded in [async-middleware](../queued/async-middleware.md).
**Inputs:** the [Astro Proposal](astro-proposal.md) (at `0b4f6de`, with its five review
questions), [design proposals](middleware-design-proposals.md) (Sol and Astra notes),
[Fable review](middleware-review-fable.md), [experiments](middleware-experiments/README.md).

**Owner priorities (2026-11-01):** the simplest contract for the future, without workarounds — code
will be simplified further after the next release. A memory difference of this size is acceptable
and not the deciding factor. Node 24 (LTS) is the baseline: anything that works only on Node 26 must
be said explicitly.

## 1. Verdict: strict onion — Astra's contract

One middleware signature, used by every middleware:

```ts
type Next = () => Promise<HttpResponse>;
middleware(ctx: RequestContext, next: Next): HttpResponse | Promise<HttpResponse>;
```

- It meets every requirement, and behaves identically on Node 24, Node 26 and Bun (§3, §5).
- It is one contract to learn, document, type and test — the owner's priority. H's advantage is
  memory and CPU (§4); the owner accepts that difference.
- The safety guards it needs are cheap enough in production, and TypeScript catches a forgotten
  `return next()` (§6).

An earlier version of this file recommended H. That was weighted on memory; with the owner's
priority set, H stays the measured alternative, not the recommendation.

## 2. The contract

```ts
class Auth extends Middleware {
  //               check, then pass on
  middleware(ctx: RequestContext, next: Next) {
    if (!ctx.appInfo.user)
      throw new UnauthorizedError({ code: 'AUTH001' /* … */ });
    return next();
  }
}

class Role extends Middleware {
  //               stop early with a response
  middleware(ctx: RequestContext, next: Next) {
    if (!hasRole(ctx)) return HttpResponse.json(403, { error: 'NO_ACCESS' });
    return next();
  }
}

class UserScope extends Middleware {
  //          own AsyncLocalStorage store for the rest
  middleware(ctx: AuthenticatedContext, next: Next) {
    return currentUser.run(ctx.appInfo.user, next);
  }
}

class RequestLogger extends Middleware {
  //      after the response is sent
  middleware(ctx: RequestContext, next: Next) {
    ctx.onFinish(({ outcome, status, durationMs }) =>
      ctx.logger.info('HTTP request completed', {
        method: ctx.method,
        outcome,
        status,
        durationMs,
      }),
    );
    return next();
  }
}

class Transaction extends Middleware {
  //        try/catch/finally around the rest
  async middleware(ctx: RequestContext, next: Next) {
    const session = await db.startSession();
    session.startTransaction();
    ctx.appInfo.session = session;
    try {
      const response = await next();
      await session.commitTransaction();
      return response;
    } catch (err) {
      await session.abortTransaction();
      throw err; //                                       the registry picks the status later
    } finally {
      await session.endSession();
    }
  }
}
```

Rules:

1. `return next()` passes the request on and returns what the rest produced. Returning an
   `HttpResponse` without calling `next` stops the chain. Throwing rejects; the error travels up
   through every middleware unchanged and is resolved by the registry once, at the top.
2. `void`, patch objects and sentinels are not continuation signals. The final value must be a
   response.
3. **Production guards** (the `safe` runner in §4; revised after the contract review, §11):
   `next()` always returns a Promise; it works once — a second call fails the request; it is
   refused once its own middleware call has settled (per-invocation expiry) or the request has
   chosen its response — a late call is refused without touching the chosen response; every
   started suffix (later middleware, handler, wrapper cleanup) is awaited before the answer is
   used; no misuse can become an `unhandledRejection`; a final value that is not a response is a
   `TypeError`.
4. **Development diagnostics** (the `dev` runner): additionally checks each middleware's result and
   names the one that broke the rule ("`Forgot` must return a response — missing `return next()`?").
   koa-compose 4.2 splits production and development checks the same way.
5. A v2 middleware extends the new `Middleware` base (decided 2026-11-01); v1 `(req, res, next)`
   classes keep `AbstractMiddleware` and the bridge. Controllers opt in with `contractVersion = 2`.
   Built-ins stay v1 through v5, as the plan already says.

## 3. Checked against every requirement

[contract-check.mjs](middleware-experiments/contract-check.mjs) `conformance`, both models, three
runner modes, real timers, Node 24.22.2, Node 26.12.1 and Bun 1.4.4. **Results are identical on all
three runtimes.** The script exits 1 when a guarded (`safe`/`dev`) case fails and reports skipped
cases (none: the OTel case ran with real packages). Astra's
[review probes](middleware-experiments/contract-review-probes.mjs) pass on all three runtimes.

| Requirement / case                                                    | Strict onion (safe, dev)                | H (safe, dev) | Without guards (raw), both models                    |
| --------------------------------------------------------------------- | --------------------------------------- | ------------- | ---------------------------------------------------- |
| R1 early response stops the chain (Role → 403)                        | ✅                                      | ✅            | ✅                                                   |
| R1 request-only middleware stay simple                                | `return next()` needed (owner accepts)  | no `next`     | —                                                    |
| R2 after-part sees and replaces the response                          | ✅                                      | ✅            | ✅                                                   |
| R3 after send (`onFinish`)                                            | same mechanism in both                  | same          | —                                                    |
| R4 own store reaches later middleware, handler, deep code (40 conc.)  | ✅                                      | ✅            | ✅                                                   |
| R5 middleware span parents the handler span (real OTel)               | ✅                                      | ✅            | ✅                                                   |
| R6 handler throws → rollback, original error reaches the top          | ✅                                      | ✅            | ✅                                                   |
| R6 commit on success; a non-`Error` throw passes unchanged            | ✅                                      | ✅            | ✅                                                   |
| R8 lazy stream read after the transaction closed (documented rule)    | closed — as documented                  | same          | same                                                 |
| `next()` called twice                                                 | ✅ error, handler once                  | ✅            | handler ran 2×                                       |
| `next()` not awaited, other response returned, handler throws         | ✅ 202 after handler, no unhandled      | ✅            | answered before handler ended + `unhandledRejection` |
| stored `next()` called after the answer                               | ✅ refused, handler never runs          | ✅            | handler ran after the answer                         |
| forgotten `return` (`await next()` only)                              | ✅ `TypeError` (dev names it)           | ✅ (wrappers) | no response at all                                   |
| throw after an un-awaited `next()`                                    | ✅ error after handler ended            | ✅            | answered before handler ended                        |
| started cleanup awaited before answering (review)                     | ✅                                      | ✅            | answered before cleanup                              |
| a finished middleware cannot start its discarded suffix (review)      | ✅ refused, 403 kept, handler never ran | ✅            | handler ran though 403 was chosen                    |
| `next()` is a Promise for sync early response and sync error (review) | ✅                                      | ✅            | (raw returns plain values)                           |

Both designs meet every requirement once guarded. Without guards both fail the same misuse cases,
so the guards are required in either design; the difference is only how many middleware pay for
them (every middleware in onion, wrappers only in H).

## 4. Measurements

[contract-check.mjs](middleware-experiments/contract-check.mjs) `memory` / `cpu`, a fresh process
per cell. Route mixes from our built-ins: _minimal_ = Auth + Role; _typical_ = RequestParser, I18n,
GetUserByToken, Auth, Role, RateLimiter (4 async, 2 sync); _+scope_ adds UserScope; _+tx_ adds
Transaction; _heavy_ = 8 async + 2 wrappers. Raw results:
[Node 24](middleware-experiments/contract-check-node24.json),
[Node 26](middleware-experiments/contract-check-node26.json),
[Bun](middleware-experiments/contract-check-bun.json).

Retained heap per request pending in the handler (bytes, median of 5, 10 000 pending), production
(`safe`) runners with the revised guards (§11):

| Route            | Node 24 onion | Node 24 H | Node 26 onion | Node 26 H | Bun onion | Bun H |
| ---------------- | ------------- | --------- | ------------- | --------- | --------- | ----- |
| minimal          | 324           | 487       | 599           | 543       | 188       | 92    |
| typical          | 2 265         | 486       | 2 321         | 545       | 1 808     | 92    |
| typical+scope    | 2 634         | 1 103     | 2 695         | 1 159     | 1 920     | 288   |
| typical+scope+tx | 3 480         | 1 929     | 3 547         | 2 001     | 2 528     | 1 040 |
| heavy            | 4 363         | 1 103     | 4 418         | 1 158     | 3 536     | 288   |

Dispatch CPU per request (ns, no HTTP, median of 5 × 100 000), production runners (noisier than
memory; differences below ≈ 300 ns are not meaningful):

| Route            | Node 24 onion | Node 24 H | Node 26 onion | Node 26 H | Bun onion | Bun H |
| ---------------- | ------------- | --------- | ------------- | --------- | --------- | ----- |
| minimal          | 1 341         | 523       | 1 141         | 465       | 1 791     | 1 400 |
| typical          | 3 616         | 1 248     | 3 774         | 1 282     | 6 539     | 3 060 |
| typical+scope    | 4 131         | 2 279     | 3 810         | 2 119     | 7 056     | 4 195 |
| typical+scope+tx | 3 845         | 2 362     | 4 253         | 2 614     | 7 624     | 4 410 |
| heavy            | 6 449         | 3 557     | 5 983         | 2 979     | 10 583    | 5 417 |

Reading:

- With the complete guards, strict onion keeps ≈ 1.5–1.8 KB more per pending request than H on a
  realistic route (Node 24, Node 26 and Bun alike), ≈ 3.3 KB on the heavy mix — ≈ 15–33 MB at
  10 000 pending requests, against ≈ 63 MB that Express itself holds for them. It costs
  ≈ 1.5–2.5 µs (Node) / ≈ 3–3.5 µs (Bun) more per request; one framework request is ≈ 45 µs, so
  ≈ 3–6 % on Node, ≈ 7–8 % on Bun. (Before the review the guards were incomplete and the gap was
  ≈ 0.8 KB / 0.3–0.6 µs.)
- The cost is the per-invocation expiry: every `async` middleware's own result must be observed.
  Without guards the two models are close (onion raw 1 353 B vs H raw 1 159 B, Node 26,
  typical+scope+tx). Development diagnostics add ≈ 1–1.5 KB more; development only.
- Small values (and the few negative Bun values) are within measurement noise of the baseline.
- Both are still faster than today's 5.x bridge (≈ 4.7 µs dispatch for 10 middleware, Fable's
  measurement) on Node.

## 5. Node 24 vs Node 26

No difference in behaviour: every conformance case gives the same result on Node 24.22.2 and
26.12.1 (and Bun 1.4.4). Memory and CPU differ by noise only. AsyncLocalStorage uses
`AsyncContextFrame` by default since Node 24, so nothing in this design needs Node 26. Nothing
here has to be marked "Node 26 only".

## 6. TypeScript catches the forgotten `return`

With `Next = () => Promise<HttpResponse>` and the base method typed
`HttpResponse | Promise<HttpResponse>`, TypeScript 7.0.2 (`strict`) rejects a subclass that forgets
`return next()` — sync, `async` with `await next()`, and on one branch only
([contract-types.ts](middleware-experiments/contract-types.ts)). It cannot see a `next()` called
without `await` before returning another response; the runtime guard handles that one.

**Consequence for the v5 bridge** (Astra's question 2, changed from the previous version of this
file): do not make `next()` return `undefined` when a v1 handler answered through `res`. With
`Promise<HttpResponse | undefined>` TypeScript stops catching the one-branch case. Instead the
bridge returns an explicit response descriptor kind for "already sent by legacy code" (for example
`kind: 'sent'`): the writer skips it, replacing it is a clear error, and the public type stays
`Promise<HttpResponse>` in v5 and v6. v6 removes the kind with the v1 bridge. A client abort
rejects `next()` with `ctx.signal.reason`, so `finally` and rollback run.

## 7. Carried over unchanged

From the Astro Proposal and the earlier version of this file:

- **Order:** pipeline → wrappers unwind (raw errors pass through) → registry once → global
  `transformResponse` (existing policy) → writer merges staged `ctx.response` headers into every
  response, errors included → `onFinish` exactly once with `finished | aborted | failed`.
- **Writer failure** before headers: registry once more, no replay of middleware. After headers:
  destroy, `onFinish` gets `failed`.
- **Streams:** a resource held by a middleware ends before a lazy stream is read (§3 R8) —
  materialise inside the transaction or release in `onFinish`. A replaced stream source is
  cancelled.
- **Transactions:** an explicit session; never a retrying helper such as Mongoose's
  `connection.transaction` around `next()` (it calls `session.withTransaction`, which can run the
  callback again).
- **Framework AsyncLocalStorage:** one instance, one store per request, active through dispatch,
  errors, writer and completion; completion callbacks restore the framework request context.
- **No per-request `beforeSend`** in the first version; add it only for a concrete need.
- **Context (decided 2026-11-01):** a separate `RequestContext` object for v2 code in 5.x (80 B per
  request, measured), so the planned names stay clean: `ctx.route` = template string, `ctx.url` =
  `URL`, `ctx.path` decoded, `ctx.ip` from IpDetector. v1 code keeps Express `req`; `appInfo` is
  shared. In v6 this object is the request context.
- **Scope:** finish the portable contract so Express becomes an adapter; native validation and
  paired Rust middleware are later options with their own gates. First deliverable: a pipeline
  `(ctx) => Promise<HttpResponse>` proven by a conformance fixture without Express.

## 8. Limits of these checks

- Kernels, not the production runner and not real HTTP; re-measure the real runner (heap, RSS,
  CPU, p95/p99, Node 24, Node 26, Bun) before shipping, as Astra's decision gate asks.
- The earlier window (a stored `next()` called after its own middleware returned, before the
  request finished) is closed by per-invocation expiry since the review (§11).
- Every built-in middleware gains a `return next()` line when it moves to v2.

## 9. Decisions (owner, 2026-11-01)

1. **D2.1 flow: strict onion.** Decided.
2. **v5 bridge:** any form is acceptable because v6 removes it. Use the explicit "already sent"
   response kind (§6): it keeps the v2 `Next` type `Promise<HttpResponse>` the same in v6.
3. **Framework request store on by default.** Decided: yes.
4. **D2.4 staged headers on error responses too.** Decided: yes.
5. **D2.2 names:** decided — option C: a separate `RequestContext` object in 5.x (80 B per request)
   with the clean names (`route`, `url`, `path`, `ip`, `cookies`).
6. **D2.3 state:** keep `ctx.appInfo`, typed per route by codegen.
7. **D2.5 cookies:** helpers on `ctx` with secure defaults.
8. **D2.7 handlers:** v6 handlers get the same `ctx`; 5.x controllers opt in with `contractVersion = 2`.
9. **v2 base class:** a new `Middleware` base for v2 middleware; `AbstractMiddleware` stays v1 and
   is removed in v6 (contract review finding 1).
10. **v1 code inside a v2 chain:** its errors reach the v2 wrappers first (option A), so a v2
    transaction around an old controller rolls back. v6 must stay final for years:
    [v6-api-stability](../queued/v6-api-stability.md).

All D2 decisions are settled; the plan is [async-middleware](../queued/async-middleware.md).

## 10. After the decision

1. Write the chosen contract and the files list into P1m; move it to `active/` when work starts.
2. Build the portable pipeline with the `safe`/`dev` guards and its conformance fixture without
   Express; reuse the cases in `contract-check.mjs`.
3. Connect it to the existing writer and the Express adapter; keep the v1 bridge.
4. Continue the Node adapter and Express removal plans.

## 11. Contract review by Astra (2026-11-01) — responses

[Review](middleware-contract-review-astro.md) of `dd6a39a`. Each finding was checked against the
code before acting.

| Finding                                                         | Checked                                                                                                                     | Action                                                                                                                                                                                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. v2 base class (TS2416)                                       | true (same conflict P1m flagged)                                                                                            | Decided (owner, option A): a new `Middleware` base for v2, kept in v6; `AbstractMiddleware` stays v1. Recorded in P1m with the affected files.                                                                       |
| 2. v1 handler inside a v2 chain commits on error                | true (`controllers/index.ts` catches and returns 400/500)                                                                   | P1m: when a v1 handler runs inside the portable chain, its errors escape to the outer wrappers first; the standalone v1 path is unchanged. Bridge `next(err)`/sync throw/rejection keep raw identity.                |
| 3. Legacy terminal outcome                                      | true (`ExpressAdapter` treats `close` as success; staged headers would miss legacy writes)                                  | Astra's outcome table adopted into P1m: flush staged headers/cookies at the legacy write boundary, reject later staging, `aborted` on premature close, `sent` kind visible in the v5 response union (removed in v6). |
| 4. Guards: started cleanup, per-invocation expiry               | true (reproduced: answered before cleanup; handler ran though 403 was chosen)                                               | Fixed in the kernels; conformance cases added; re-measured (§4).                                                                                                                                                     |
| 5. `next()` not a Promise in production                         | true (`next(...).then is not a function`)                                                                                   | Fixed: `next()` always returns a Promise; case added.                                                                                                                                                                |
| 6. `onFinish` shape; conformance not a gate                     | true                                                                                                                        | P1m interface updated to `{ outcome, status?, error?, durationMs }`, exactly once; conformance now exits 1 on a failed guarded case and reports skips.                                                               |
| Writer: pending first chunk after disconnect never settles      | true, and wider: Node's `pipeline` also never settles when a **later** chunk is pending after a disconnect (Node 24 and 26) | Fixed in `ExpressResponseWriter`: every read races the disconnect; own write loop with backpressure instead of `pipeline`. Tests for first and later chunk, large stream.                                            |
| Writer: `return()` throwing synchronously escapes               | true (uncaught exception)                                                                                                   | Fixed: stopping a source never throws; test added.                                                                                                                                                                   |
| Writer: `transformResponse` replacing a stream leaks its source | true                                                                                                                        | Fixed: a replaced stream source is cancelled; a re-wrapped one is kept; test added.                                                                                                                                  |
| Files/acceptance additions                                      | accepted                                                                                                                    | Added to P1m (base module, `AbstractController`, `RouteNode`, `middlewareNormalization`, handler version, codegen, extension-hook types, export subpath, lockfile, request-entry scope).                             |
