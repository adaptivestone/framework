# P1m — Async/await middleware contract (breaking)

**Status**: ⏸ v6 cutover — promoted from the "v6 breaking defaults" bullet list (was "Awaitable `next()` middleware contract"). Design call open (see D1).
**Depends on**: P1b ✅ (tree router / `ExpressAdapter`). Best landed alongside [static-middleware-cutover](static-middleware-cutover.md) — both touch `AbstractMiddleware` + the adapter, so one breaking-doc migration note for users.
**Time**: ~½ day (signature + adapter simplification) + framework middleware migration + docs.
**Origin**: the middleware contract still threads Express's `next` callback. Everything else in the request path is already `async`/`await` (the adapter `await`s each middleware and the handler). `next` is the last callback-style seam; dropping/awaiting it makes the contract uniform and lets the adapter's `runMiddleware` Promise-bridge go away.

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

## D1 — the design decision (resolve before building)

| Option | Contract | Continue / error / stop | Notes |
|---|---|---|---|
| **A — Linear, drop `next` (recommended)** | `async middleware(req, res): Promise<void>` | return → continue · `throw` → error · send response → stop | Faithful to today's linear semantics. Smallest surface. `runMiddleware` Promise-bridge + `finish`/`close` listeners **deleted** — loop becomes `await instance.middleware(req, res)` then the existing `writableEnded`/`destroyed` check. |
| **B — Awaitable `next()` (onion)** | `async middleware(req, res, next): Promise<void>`, `next()` returns a Promise resolving after the rest of the chain | `await next()` runs downstream then returns control · `throw`/no-call → as today | New capability (post-handler timing, cleanup, wrap-around). More machinery; `next` stays. Matches the old bullet's wording. |

Recommendation: **Option A.** It matches current behavior exactly, is the minimal breaking change, and removes the most code. Pick **B** only if a concrete consumer needs wrap-around middleware (response timing/cleanup that must run *after* the handler) — none in the framework today. **Do not build B speculatively.**

The rest of this plan assumes **A**; the B-specific deltas are called out where they differ.

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
  async middleware(req, res) {
    req.appInfo.user = await resolveUser(req);
    // return to continue
  }
}
```

Migration is mechanical: drop the `next` param, replace `return next()` / `next()` with a plain `return` (or nothing), replace `next(err)` with `throw err`. Sending a response and not continuing is unchanged.

## Files touched

- `src/services/http/middleware/AbstractMiddleware.ts` — `middleware(req, res)` signature (drop `next`); default impl `this.logger?.warn(...)` + return instead of `return next()`; `getMiddleware()` unchanged (still binds). Update the `Promise<void | Response>` return type → `Promise<void>` (A).
- `src/services/http/routing/ExpressAdapter.ts` — `runMiddleware` collapses to `await instance.middleware(req, res)` (no `new Promise`, no `settle`, no `finish`/`close` listeners); the dispatch loop keeps the `writableEnded || res.destroyed` early-out and the surrounding `try/catch → next(err)`. **(B)**: keep `next`, build a per-step continuation that runs the remainder of the loop and pass it in.
- Framework's own middlewares — migrate each (`GetUserByToken`, `Cors`, `RequestLogger`, `Pagination`, `RateLimiter`, etc. — full list to be enumerated when building) from `next()`/`next(err)` to return/`throw`.
- `src/services/http/HttpServer.ts` — `FrameworkRequest` / any middleware-signature types referenced there.
- Handler contract: **out of scope** — route handlers still receive Express `next` for error forwarding (`result.entry.handler(req, res, next)` stays). Only *middleware* changes.
- Tests: `AbstractMiddleware.test.ts`, `ExpressAdapter.test.ts`, and each migrated middleware's test. Add a case proving `throw` → error path and "response sent → chain stops".
- Docs: `06-Controllers/03-middleware.md` (rewrite the contract section + a BEFORE/AFTER migration block), `16-anti-patterns.md` (drop any "always call next()" guidance), CHANGELOG `[BREAKING]`.

## What this removes / simplifies

| Today | After (A) |
|---|---|
| `runMiddleware` `new Promise` + `settle` + `res.once('finish'/'close')` bookkeeping | gone — `await instance.middleware(req, res)` |
| Three ways to signal (`next()` / `next(err)` / respond) | two (return / `throw`) + respond-and-return |
| `next` callback threaded through every middleware | absent |
| `Promise<void \| Response>` return union | `Promise<void>` |

## Out of scope

- Route **handler** signature (keeps Express `next` for error forwarding) — separate decision if ever wanted.
- Global Express middleware mounted directly via `app.express.use` (Cors-as-global, security headers, `RequestParser`) — those run on the raw Express stack, not the adapter loop; they keep Express's native `(req,res,next)`. This card is only the **registry-dispatched** middleware contract. (Confirm the framework-middleware list against this split when building.)
- Static metadata getters — that's [static-middleware-cutover](static-middleware-cutover.md); land together but they're orthogonal changes.
- `WeakMap` instance cache keyed by `(Class, params)` — orthogonal request-time dedup, tracked elsewhere.

## Done when

- `AbstractMiddleware.middleware` signature is `(req, res)` (A) / `next` is awaitable (B); default impl no longer calls a `next` callback.
- `ExpressAdapter.runMiddleware` Promise-bridge + `finish`/`close` listeners removed (A); dispatch loop still early-outs on `writableEnded`/`destroyed` and forwards thrown errors via the outer `try/catch`.
- All framework-own registry middlewares migrated; full suite + `gen --check` green.
- `03-middleware.md` rewritten with a one-keyword-per-middleware migration block; CHANGELOG `[BREAKING]`.

## Trade-offs

- Breaking for every consumer middleware — but mechanical (drop `next`, `return`/`throw`). One-keyword-class edits; an editor refactor handles most.
- **A** forecloses onion wrap-around (post-handler code) — acceptable since today's model already can't do it; a consumer needing it is the trigger to revisit **B**.
- **B** keeps `next` and adds continuation machinery for a capability nobody currently uses — heavier, speculative. Default to A.
