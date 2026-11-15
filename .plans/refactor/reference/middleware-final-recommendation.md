# Middleware v2 — final recommendation

**Date:** 2026-11-01. **Status:** recommendation for the owner. D2.1 in
[async-middleware](../queued/async-middleware.md) stays open until the owner decides.
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
class Auth extends AbstractMiddleware {
  //               check, then pass on
  middleware(ctx: RequestContext, next: Next) {
    if (!ctx.appInfo.user)
      throw new UnauthorizedError({ code: 'AUTH001' /* … */ });
    return next();
  }
}

class Role extends AbstractMiddleware {
  //               stop early with a response
  middleware(ctx: RequestContext, next: Next) {
    if (!hasRole(ctx)) return HttpResponse.json(403, { error: 'NO_ACCESS' });
    return next();
  }
}

class UserScope extends AbstractMiddleware {
  //          own AsyncLocalStorage store for the rest
  middleware(ctx: AuthenticatedContext, next: Next) {
    return currentUser.run(ctx.appInfo.user, next);
  }
}

class RequestLogger extends AbstractMiddleware {
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

class Transaction extends AbstractMiddleware {
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
3. **Production guards** (the `safe` runner in §4): `next()` works once — a second call throws;
   `next()` is refused once the response has been chosen; every started downstream promise is
   marked handled, so misuse never becomes an `unhandledRejection`; a started handler is awaited
   before the answer is used; a final value that is not a response is a `TypeError`.
4. **Development diagnostics** (the `dev` runner): additionally checks each middleware's result and
   names the one that broke the rule ("`Forgot` must return a response — missing `return next()`?").
   koa-compose 4.2 splits production and development checks the same way.
5. `static contractVersion = 2` marks a v2 class; v1 `(req, res, next)` classes keep the bridge.
   Built-ins stay v1 through v5, as the plan already says.

## 3. Checked against every requirement

[contract-check.mjs](middleware-experiments/contract-check.mjs) `conformance`, both models, three
runner modes, real timers, Node 24.22.2, Node 26.12.1 and Bun 1.4.4. **Results are identical on all
three runtimes.**

| Requirement / case                                                   | Strict onion (safe, dev)               | H (safe, dev) | Without guards (raw), both models                    |
| -------------------------------------------------------------------- | -------------------------------------- | ------------- | ---------------------------------------------------- |
| R1 early response stops the chain (Role → 403)                       | ✅                                     | ✅            | ✅                                                   |
| R1 request-only middleware stay simple                               | `return next()` needed (owner accepts) | no `next`     | —                                                    |
| R2 after-part sees and replaces the response                         | ✅                                     | ✅            | ✅                                                   |
| R3 after send (`onFinish`)                                           | same mechanism in both                 | same          | —                                                    |
| R4 own store reaches later middleware, handler, deep code (40 conc.) | ✅                                     | ✅            | ✅                                                   |
| R5 middleware span parents the handler span (real OTel)              | ✅                                     | ✅            | ✅                                                   |
| R6 handler throws → rollback, original error reaches the top         | ✅                                     | ✅            | ✅                                                   |
| R6 commit on success; a non-`Error` throw passes unchanged           | ✅                                     | ✅            | ✅                                                   |
| R8 lazy stream read after the transaction closed (documented rule)   | closed — as documented                 | same          | same                                                 |
| `next()` called twice                                                | ✅ error, handler once                 | ✅            | handler ran 2×                                       |
| `next()` not awaited, other response returned, handler throws        | ✅ 202 after handler, no unhandled     | ✅            | answered before handler ended + `unhandledRejection` |
| stored `next()` called after the answer                              | ✅ refused, handler never runs         | ✅            | handler ran after the answer                         |
| forgotten `return` (`await next()` only)                             | ✅ `TypeError` (dev names it)          | ✅ (wrappers) | no response at all                                   |
| throw after an un-awaited `next()`                                   | ✅ error after handler ended           | ✅            | answered before handler ended                        |

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
(`safe`) runners:

| Route            | Node 24 onion | Node 24 H | Node 26 onion | Node 26 H | Bun onion | Bun H |
| ---------------- | ------------- | --------- | ------------- | --------- | --------- | ----- |
| minimal          | 455           | 360       | 297           | 415       | 29        | 152   |
| typical          | 1 222         | 141       | 1 280         | 417       | 541       | −67   |
| typical+scope    | 1 687         | 919       | 1 743         | 977       | 784       | 224   |
| typical+scope+tx | 2 463         | 1 681     | 2 530         | 1 760     | 1 520     | 944   |
| heavy            | 2 359         | 1 014     | 2 415         | 1 074     | 1 361     | 304   |

Dispatch CPU per request (ns, no HTTP, median of 5 × 100 000), production runners:

| Route            | Node 24 onion | Node 24 H | Node 26 onion | Node 26 H | Bun onion | Bun H |
| ---------------- | ------------- | --------- | ------------- | --------- | --------- | ----- |
| minimal          | 486           | 412       | 451           | 376       | 1 331     | 940   |
| typical          | 1 279         | 945       | 1 205         | 872       | 3 728     | 2 192 |
| typical+scope    | 1 495         | 1 322     | 1 429         | 1 286     | 4 195     | 2 792 |
| typical+scope+tx | 1 816         | 1 430     | 1 895         | 1 334     | 5 075     | 3 317 |
| heavy            | 2 438         | 1 956     | 2 731         | 1 959     | 7 181     | 4 617 |

Reading:

- For a realistic route, strict onion keeps ≈ 0.8 KB (Node) / ≈ 0.6 KB (Bun) more per pending
  request than H, ≈ 1.3 KB on the heavy mix — ≈ 8–13 MB at 10 000 pending requests, against
  ≈ 63 MB that Express itself holds for them. It costs ≈ 0.3–0.6 µs (Node) / ≈ 1.5–1.8 µs (Bun)
  more per request; one framework request is ≈ 45 µs, so ≈ 1 % on Node, ≈ 4 % on Bun.
- The guards are most of the difference: without them the two models are close (onion raw 1 351 B
  vs H raw 1 153 B, Node 26, typical+scope+tx). Development diagnostics add ≈ 1.5 KB more; they are
  for development only.
- Small values (and the few negative Bun values) are within measurement noise of the baseline.
- Both are far below today's 5.x bridge (≈ 4.7 µs dispatch for 10 middleware, Fable's measurement).

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
- **Context names:** `routeTemplate` instead of `route` (the adapter sets `req.route` to an object);
  decide what `url` means (Node's `req.url` is a string) — D2.2.
- **Scope:** finish the portable contract so Express becomes an adapter; native validation and
  paired Rust middleware are later options with their own gates. First deliverable: a pipeline
  `(ctx) => Promise<HttpResponse>` proven by a conformance fixture without Express.

## 8. Limits of these checks

- Kernels, not the production runner and not real HTTP; re-measure the real runner (heap, RSS,
  CPU, p95/p99, Node 24, Node 26, Bun) before shipping, as Astra's decision gate asks.
- The `safe` runner refuses `next()` once the whole request has chosen its response. A stored
  `next()` called after its own middleware returned but before the request finished is not refused
  (a narrow window; the handler's result is still awaited, nothing is written twice). Closing it
  needs one more check per middleware; decide whether development diagnostics are enough.
- Every built-in middleware gains a `return next()` line when it moves to v2.

## 9. Decisions for the owner, one at a time

1. **D2.1 flow:** strict onion (recommended, §1) or H.
2. **v5 bridge:** an explicit "already sent" response kind instead of `undefined` (recommended, §6).
3. **Framework store on by default** (recommended: on) or opt-in.
4. **D2.4:** staged headers on error responses too (recommended: yes).
5. **D2.2 names:** `routeTemplate`, and what `url` means.

## 10. After the decision

1. Write the chosen contract and the files list into P1m; move it to `active/` when work starts.
2. Build the portable pipeline with the `safe`/`dev` guards and its conformance fixture without
   Express; reuse the cases in `contract-check.mjs`.
3. Connect it to the existing writer and the Express adapter; keep the v1 bridge.
4. Continue the Node adapter and Express removal plans.
