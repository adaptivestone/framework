# P1m — Async/await middleware contract (breaking)

**Status**: ⏸ v6 cutover — linear direction settled by
[P1q universal HTTP responses](../queued/universal-http-responses.md); implementation deferred.
**Depends on**: P1b ✅ (tree router / `ExpressAdapter`) and P1q v5.2 response bridge. Best
landed alongside [static-middleware-cutover](static-middleware-cutover.md) — both touch
`AbstractMiddleware` + the adapter, so one breaking-doc migration note for users.
**Time**: ~1 day (signature + adapter simplification + response returns) + framework middleware
migration + docs.
**Origin**: the middleware contract still threads Express's `res` and `next`. P1q makes returned
responses real before v6; the breaking cutover can then remove both Express-specific arguments
instead of preserving `res` while only deleting `next`.

## Current contract (what we have)

```ts
// AbstractMiddleware
async middleware(req, res, next): Promise<void | Response> {
  // ...work...
  return next();        // continue
  // next(err)          // error → ExpressAdapter catch → next(err)
  // res.json(...)      // respond + don't call next → chain stops
}
```

`ExpressAdapter.runMiddleware` wraps each call in a `new Promise` that settles when the middleware calls `next()`, when `res` emits `finish`/`close`, or when it throws; the dispatch loop `await`s it and stops early on `res.writableEnded || res.destroyed`.

**Key observation:** the current model is already *linear*, not onion. `next()` only resolves the bridge promise so the loop advances — a middleware **cannot** run code after the downstream handler completes (anything after `next()` runs detached, before the handler). So removing `next` in favor of return-to-continue is **semantics-preserving**, while a Koa-style awaitable `next()` would be a *new* capability, not a preservation.

## D1 — settled direction

| Option | Contract | Continue / error / stop | Notes |
|---|---|---|---|
| **A — Linear, no `res`/`next` (chosen)** | `async middleware(ctx): Promise<void \| HttpResponse>` | `void` → continue · response → stop · `throw` → error registry | Faithful to today's linear ordering and P1q's portable response boundary. The Promise bridge and response-event bookkeeping disappear from registry middleware dispatch. |
| **B — Awaitable `next()` (rejected until demanded)** | `async middleware(ctx, next): Promise<void \| HttpResponse>` | `await next()` runs downstream then returns control | New onion capability (post-handler timing/cleanup) with continuation machinery nobody currently needs. |

**Option A is settled.** It matches current linear ordering, removes both Express parameters, and
uses the returned-response path already exercised in v5.2. Reopen B only with a concrete
wrap-around middleware use case.

## API change (Option A)

```ts
// BEFORE (v5.x)
class GetUserByToken extends AbstractMiddleware {
  async middleware(req, res, next) {
    req.appInfo.user = await resolveUser(req);
    return next();
  }
}

// AFTER (v6)
class GetUserByToken extends AbstractMiddleware {
  async middleware(ctx) {
    ctx.appInfo.user = await resolveUser(ctx);
    // return to continue
  }
}

class RateLimiter extends AbstractMiddleware {
  async middleware(ctx) {
    if (await this.exceeded(ctx)) {
      return HttpResponse.json(429, { message: 'Too many requests' });
    }
  }
}
```

Migration is mechanical for pass-through middleware: drop `res`/`next`, replace
`return next()` / `next()` with `return` (or nothing), and replace `next(err)` with `throw err`.
Middleware that sends a response replaces `res.status(...).json(...)` with an `HttpResponse`
factory return.

## Files touched

- `src/services/http/middleware/AbstractMiddleware.ts` — `middleware(ctx)` signature; return type
  `Promise<void | HttpResponse>`; default implementation returns void.
- `src/services/http/routing/ExpressAdapter.ts` — `runMiddleware` becomes
  `await instance.middleware(ctx)`; returned descriptors go through P1q's writer; no `new Promise`,
  `settle`, or `finish`/`close` listener bridge.
- Framework's own middlewares — migrate each (`GetUserByToken`, `Cors`, `RequestLogger`,
  `Pagination`, `RateLimiter`, etc.) from `res`/`next` to context + return/throw.
- `src/services/http/HttpServer.ts` and `src/services/http/types.ts` — portable context and
  middleware-signature types.
- Handler contract: P1q's v6 cutover removes ordinary controller `res` in the same release; this
  card owns only registry-middleware mechanics.
- Tests: `AbstractMiddleware.test.ts`, `ExpressAdapter.test.ts`, and each migrated middleware's test. Add a case proving `throw` → error path and "response sent → chain stops".
- Docs: `06-Controllers/03-middleware.md` (rewrite the contract section + a BEFORE/AFTER migration block), `16-anti-patterns.md` (drop any "always call next()" guidance), CHANGELOG `[BREAKING]`.

## What this removes / simplifies

| Today | After (A) |
|---|---|
| `runMiddleware` `new Promise` + `settle` + `res.once('finish'/'close')` bookkeeping | gone — `await instance.middleware(ctx)` |
| `next()` / `next(err)` / mutate `res` | `void` / `throw` / return `HttpResponse` |
| Express `res` and `next` threaded through every registry middleware | absent |
| Transport completion detected indirectly from Express events | explicit returned response; writer owns transport completion |

## Out of scope

- Exact v6 raw-route API — P1q reserves an explicit adapter-specific escape hatch.
- Global Express middleware mounted directly via `app.express.use` (Cors-as-global, security headers, `RequestParser`) — those run on the raw Express stack, not the adapter loop; they keep Express's native `(req,res,next)`. This card is only the **registry-dispatched** middleware contract. (Confirm the framework-middleware list against this split when building.)
- Static metadata getters — that's [static-middleware-cutover](static-middleware-cutover.md); land together but they're orthogonal changes.
- `WeakMap` instance cache keyed by `(Class, params)` — orthogonal request-time dedup, tracked elsewhere.

## Done when

- `AbstractMiddleware.middleware` signature is `(ctx) => Promise<void | HttpResponse>`; neither
  Express `res` nor `next` is exposed.
- `ExpressAdapter.runMiddleware` Promise bridge and middleware-owned response-event listeners are
  removed; returned responses use `ResponseWriter`, and thrown errors use the registry.
- All framework-own registry middlewares migrated; full suite + `gen --check` green.
- `03-middleware.md` rewritten with a one-keyword-per-middleware migration block; CHANGELOG `[BREAKING]`.

## Trade-offs

- Breaking for every consumer registry middleware — but v5.2 provides a full release line to
  migrate response-producing code before v6 removes `res`.
- **A** forecloses onion wrap-around (post-handler code) — acceptable since today's model already can't do it; a consumer needing it is the trigger to revisit **B**.
- **B** keeps `next` and adds continuation machinery for a capability nobody currently uses — heavier, speculative. Default to A.
