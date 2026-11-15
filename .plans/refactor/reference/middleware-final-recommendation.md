# Middleware v2 — review of the Astro Proposal and the recommended final result

**Date:** 2026-11-01. **Status:** recommendation for the owner. D2.1 in
[async-middleware](../queued/async-middleware.md) stays open until the owner decides.
**Reviews:** the [Astro Proposal](astro-proposal.md) at `0b4f6de`, including the five review
questions in its [API trade-off section](astro-proposal.md#api-trade-off-and-recommendation).
Other inputs: [design proposals](middleware-design-proposals.md) (Sol and Astra notes),
[Fable review](middleware-review-fable.md), [experiments](middleware-experiments/README.md).

## 1. Verdict

Take the Astro Proposal almost as it is: the portable pipeline, raw errors unwinding wrappers, one
error resolution at the top, the order of the response steps, completion semantics, the stream and
transaction rules, the scope correction (no native work now) and the Express-removal path.

Change one thing: the **public shape is H** — a middleware declares either a stage
`middleware(ctx)` or a wrapper `around(ctx, next)`. Define it as **one execution contract**, the
strict onion Astra specifies, where a stage is shorthand for:

```ts
around(ctx, next) {
  const response = await stage(ctx); // void → continue, HttpResponse → stop, throw → error
  return response ?? next();
}
```

The runner may execute consecutive stages in a flat loop because that is observably the same. So
there is one semantic contract to specify and test (Astra's concern), and the guards, memory cost
and misuse surface of `next` apply only to the few middleware that wrap (Sol's and Fable's
concern).

## 2. Why H, not strict onion (Astra's question 1)

**Guarded runners cost very different amounts.** Astra's measurement compared runners without the
`next` guards that Astra itself requires ("a warning alone is insufficient"). With the guards —
single use, expiry, result check, waiting for a started but unreturned downstream — every
middleware that receives `next` must observe its own result. A synchronous `return next()` can skip
that (it returns the downstream promise itself, an identity check), but an `async` middleware
cannot. In H a stage never receives `next`, so it needs no guard.

Retained heap per request pending in the handler, 8 ordinary steps + 2 wrappers giving the rest an
own AsyncLocalStorage store, 10 000 requests, median of 5
([guarded-runners.mjs](middleware-experiments/guarded-runners.mjs), both runners with the same
fast path):

| Ordinary steps | Node strict onion, guarded | Node H, guarded | Bun strict onion, guarded | Bun H, guarded |
| -------------- | -------------------------- | --------------- | ------------------------- | -------------- |
| synchronous    | 408 B                      | 408 B           | 272 B                     | 256 B          |
| `async`        | 4 060 B                    | 1 041–1 123 B   | 2 656 B                   | 352 B          |

Without guards the same kernels give 1 576 B vs 1 096 B (Node, async), matching Astra's ≈ 0.7 KB.
With the guards the gap is ≈ 3 KB per pending request on Node (≈ 30 MB at 10 000) and ≈ 2.3 KB
on Bun. For scale, a pending request on Express holds ≈ 6.3 KB. Async steps are the realistic
case: `GetUserByToken`, `RateLimiter`, `RequestParser` and `I18n` all `await`. These are kernels,
not the production runner; the gap must be re-checked on the real runner before shipping (§7).

**Misuse surface.** In strict onion every middleware can call `next()` without `return`, call it
twice or keep it; the runner must catch all of it for every middleware. In H only `around` can.
None of the 11 built-in middleware needs `around` (Fable checked each one), so all of them become
stages.

**Astra's own native architecture favours a declared stage.** A stage has no continuation, so a
paired Rust implementation needs no continuation bridge, and contiguous stages are the natural unit
to fuse later ([paired middleware](astro-proposal.md#paired-middleware-implementations)). In strict
onion the boot plan cannot tell a pass-through from a wrapper — both are `(ctx, next)` — without
the very declaration H has.

**Astra's argument for one contract** — "a simple middleware may grow wrapping behaviour" — still
holds as a small local edit: rename `middleware` to `around` and add `next`. That is the moment the
author must think about continuation anyway.

**What H costs:** two method names, and a class must define exactly one (boot error otherwise).

## 3. Answers to Astra's questions 2–5

**2. The v5 bridge.** `type Next = () => Promise<HttpResponse | undefined>` in v5, where
`undefined` means only "downstream answered through `res` (a v1 handler or middleware), there is
nothing to inspect". That is honest and needs no sentinel. v6 removes v1 and narrows the type to
`Promise<HttpResponse>`; narrowing a return type does not break `around` implementations. A client
abort is **not** `undefined`: `next()` rejects with `ctx.signal.reason`, so `finally` and rollback
run. Keep `static contractVersion = 2` (already approved): detection by method name is impossible
because a v1 class and a v2 stage both define `middleware`. Built-ins stay v1 through v5, as the plan
already says.

**3. Guard rules, precise.**

1. `next` can be called once. A second call throws synchronously, naming the middleware.
2. `next` expires when the `around` call settles; a later call throws and runs nothing.
3. `around` must return a branded `HttpResponse` (or v5's `undefined` from `next`). Anything else is
   a `TypeError` naming the middleware, resolved by the registry. No auto-continue, no auto-bubble
   (Astra and Sol; Fable preferred forgiving).
4. If downstream started and `around` returned or threw without waiting for it, the runner waits for
   downstream to settle before it answers. A downstream rejection that nobody observed is logged
   once, never an `unhandledRejection`.
5. Cost: nothing for stages; nothing for a synchronous `return next()` / `return store.run(v, next)`;
   one reaction for an `async` wrapper (table above).

**4. Order and semantics.** Astra's order, without per-request `beforeSend` for now:

```
adapter: ctx → framework store entered → ctx.signal armed → onFinish listeners armed
pipeline: stages (flat loop) / around … → validation → handler
  ◄ wrappers unwind; raw errors (Error or not) pass through them unchanged
registry: resolves an uncaught error once → HttpResponse; ctx.error = the original
transformResponse (global, existing P1q policy: a broken transform is logged, original kept)
writer: staged ctx.response headers merged into every response, errors included → render/stream
onFinish: exactly once; { outcome: 'finished' | 'aborted' | 'failed', status?, durationMs };
          each callback contained; runs in the framework request context
```

- A writer failure before headers are sent is resolved by the registry once more — middleware and
  hooks are never replayed. After headers are sent: destroy, `onFinish` gets `failed`.
- An `around` that replaces a stream response must not leak it: the runner cancels the unused
  stream source, as the writer already does for `HEAD` and aborts.
- A resource held by an `around` ends when the handler returns its descriptor, before a lazy stream
  is read. Materialise the data inside the transaction, or release in `onFinish` and accept that a
  failed stream cannot roll back. Documentation rule, no runtime detector.
- A returned 4xx is a successful return, not an error; a transaction that rolls back on status must
  say so explicitly.
- Transactions use an explicit session (start, commit, abort, end). Never put a retrying helper
  around `next()`: Mongoose 9.11.4's `connection.transaction` calls the driver's
  `session.withTransaction`, which can run its callback again (checked in
  `node_modules/mongoose/lib/connection.js`).
- `onFinish` callbacks restore the framework request context, not the registration's full async
  context (no hidden retention of middleware scopes); capture a value explicitly if needed.

**5. Context without Express types, no native infrastructure.** v2 middleware, handlers, error
handlers and `transformResponse` are typed against a framework-owned `RequestContext`; Express
types stay inside the v1 bridge. Two names in the queued `RequestContext` collide with what the v5
runtime object already has: `ctx.route` (the adapter sets `req.route = { path }`) and
`ctx.url: URL` (Node's `req.url` is a string). Use `routeTemplate`, and keep `url` with Node's
string meaning or give the parsed URL another name — part of D2.2. Nothing native is needed now;
the only forward-compatible pieces are the declared stage/wrapper kind, static middleware params
and the response descriptors, which already exist.

## 4. Taken from the Astro Proposal unchanged

- **Scope:** finish the portable contract so Express becomes an adapter; native transport,
  validation and paired middleware are later options with their own gates. No IR, ABI, capability
  registry or backend selection now.
- **Smallest deliverable:** a pipeline callable as `(ctx) => Promise<HttpResponse>` that composes
  middleware, validation and the handler and resolves an uncaught error after wrappers unwind,
  proven by a conformance fixture **without Express**. Validation order unchanged.
- **`beforeSend`:** not in the first patch. Staged headers, `around` and the global
  `transformResponse` cover every case known today. Add it only for a concrete need, as the single
  per-request preparation hook Astra describes (newest first, frozen when preparation starts).
- **Framework AsyncLocalStorage:** one instance, one store per request, active through dispatch,
  error resolution, writer and completion.
- **Tracing:** public OTel APIs (`context.with`, `startActiveSpan`), no private context-manager
  fields; framework tracing channels as the integration mechanism, not an application API; reuse an
  existing HTTP server span.
- **Conformance list:** as in the proposal's
  [delivery path](astro-proposal.md#delivery-path-and-acceptance), plus the guard rules above.
- **JSON Schema:** the Standard JSON Schema interface exists (`StandardJSONSchemaV1` in the
  installed `@standard-schema/spec`); `toJsonSchema` stays an OpenAPI exporter and never authorises
  native validation. Later, behind its own equivalence gate.

## 5. The final result

```ts
abstract class AbstractMiddleware {
  static get contractVersion(): 1 | 2; //                  1 = today's (req, res, next), default in v5

  // v2: a class defines exactly one of these
  middleware?(ctx: RequestContext): void | HttpResponse | Promise<void | HttpResponse>;
  around?(ctx: RequestContext, next: Next): HttpResponse | Promise<HttpResponse>;
}
type Next = () => Promise<HttpResponse | undefined>; //    v6: Promise<HttpResponse>

// on ctx
ctx.response.setHeader(name, value); //                    staged, applied to every response
ctx.onFinish((r: { outcome: 'finished' | 'aborted' | 'failed'; status?: number; durationMs: number }) => {});
ctx.signal; //                                             aborts when the client goes away
requestContext(); //                                       the current ctx, from anywhere
```

```ts
class Auth extends AbstractMiddleware {
  //                 stage: check and finish
  static get contractVersion() {
    return 2 as const;
  }
  middleware(ctx: RequestContext) {
    if (!ctx.appInfo.user)
      throw new UnauthorizedError({ code: 'AUTH001' /* … */ });
  }
}

class UserScope extends AbstractMiddleware {
  //            wrapper: own store for everything after
  static get contractVersion() {
    return 2 as const;
  }
  around(ctx: AuthenticatedContext, next: Next) {
    return currentUser.run(ctx.appInfo.user, next);
  }
}

class RequestLogger extends AbstractMiddleware {
  //        stage + completion
  static get contractVersion() {
    return 2 as const;
  }
  middleware(ctx: RequestContext) {
    ctx.onFinish(({ outcome, status, durationMs }) =>
      ctx.logger.info('HTTP request completed', {
        method: ctx.method,
        outcome,
        status,
        durationMs,
      }),
    );
  }
}

class Transaction extends AbstractMiddleware {
  //          wrapper: try/catch/finally
  static get contractVersion() {
    return 2 as const;
  }
  async around(ctx: RequestContext, next: Next) {
    const session = await db.startSession();
    session.startTransaction();
    ctx.appInfo.session = session;
    try {
      const response = await next();
      await session.commitTransaction();
      return response;
    } catch (err) {
      await session.abortTransaction();
      throw err; //                                        the registry picks the status later
    } finally {
      await session.endSession();
    }
  }
}
```

## 6. Decisions for the owner, one at a time

1. **D2.1 flow:** H as one contract with stage shorthand (recommended) or strict onion.
2. **Framework store on by default** (recommended: on; +0.15–0.4 µs and ≈ 0.1–0.2 KB per request;
   logging and tracing need it for every request) or opt-in.
3. **D2.4:** staged headers on error responses too (recommended: yes).
4. **D2.2 names:** `routeTemplate`, and what `url` means.
5. **Confirm** `beforeSend` is deferred and `around` is strict.

## 7. After the decision

1. Write the chosen contract and the files list into P1m
   ([async-middleware](../queued/async-middleware.md)); move it to `active/` when work starts.
2. Build the portable pipeline and its conformance fixture without Express; re-measure the guarded
   runner on Node and Bun with real workloads (heap, RSS, CPU, p95/p99), as Astra's decision gate
   asks.
3. Connect it to the existing writer and the Express adapter; keep the v1 bridge.
4. Continue the Node adapter and Express removal plans.
