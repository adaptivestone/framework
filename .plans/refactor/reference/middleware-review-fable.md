# Middleware flow for @adaptivestone/framework — every viable idea, measured, with a recommendation

Reviewer: Fable. Date: 2026-11-01. Independent of `middleware-design-proposals.md` (not read).
Scripts referenced below as `…/scratchpad/fable-exp/` are copied to
[middleware-experiments/fable](middleware-experiments/fable/); other scripts are in
[middleware-experiments](middleware-experiments/README.md).
Everything below was checked against the source in `/home/user/framework` and the cloned frameworks in
`/tmp/claude-0/-home-user-framework/9696e70e-b2d3-5bd7-b2c5-f119416e5a4d/scratchpad/repos/`.
Numbers were re-measured on Node 26.12.1 and Bun 1.4.4 (scripts in
`/tmp/claude-0/-home-user/9696e70e-b2d3-5bd7-b2c5-f119416e5a4d/scratchpad/fable-exp/`, see Appendix A).

Short version: **choose "hybrid by declaration"** — a middleware class has either `middleware(ctx)`
(request-only, exactly as simple as today) or `around(ctx, next)` (wraps the rest of the request).
Compose the chain once per route at boot. Add two companions: one framework-owned AsyncLocalStorage
store per request (`requestContext()`), and `ctx.onFinish(cb)` for after-send work. Write the response
after the chain has unwound. Let `next()` reject with the real error, and resolve errors through the
registry once, at the top. Details and rules in §4.

---

## 1. The core problem in one paragraph

A request goes through a line of middleware, then the handler, then the response is written. Most
middleware only look at the request and let it pass or stop it (Role, Auth, RateLimiter). Those are
easy in any model. The hard ones need to be _around_ the rest of the request: a span that must be
the parent of what the handler does, an AsyncLocalStorage store that the handler and deep services
must see, a DB transaction that is committed or rolled back depending on what the handler did, a
timer from "request in" to "response out". "Around" means: some code of the middleware runs
_before_, the rest of the request runs _inside the middleware's own call_ (same async context), and
some code runs _after_. In today's framework nothing runs inside a middleware's call: `runMiddleware`
(`src/services/http/routing/ExpressAdapter.ts:164-217`) only waits for `next()` to be called, then
the adapter's own loop continues. So `als.run(store, () => next())` reaches nothing, and code after
`next()` runs _before_ the handler. The design question is: who pays for wrapping — every middleware
(onion), only the ones that ask (hybrid, `runInside`), or nobody (stages + callbacks + a framework
store)? The price of wrapping is one suspended async function per wrapping layer for as long as the
request is in flight, plus a few rules about `next()`.

### 1.1 What exists today (verified in the source)

- `AbstractMiddleware.middleware(req, res, next)` (`src/services/http/middleware/AbstractMiddleware.ts:134-142`).
  Request-only middleware throw `HttpError` subclasses (`Role.ts:29-33, 47-51`) or `return next()`.
- `runMiddleware` (`ExpressAdapter.ts:164-217`) builds one `Promise` per middleware per request,
  adds `finish` and `close` listeners on `res`, and settles when `next()` is called, the response
  finishes, or the middleware throws. The promise returned by `middleware()` is used only for its
  rejection (`.catch(settle)`, line 215). Consequences, re-verified on Node 26.12.1 and Bun 1.4.4
  (Appendix A.1):
  - code after `next()` runs before the handler, not after it;
  - `als.run(store, () => next())` does not reach the handler; `als.enterWith` works only before the
    middleware's first `await`; an Express middleware mounted before the adapter works.
- Handler errors: caught by the controller wrapper (`src/controllers/index.ts:528-539`) →
  `answerError` (606-625) → `app.httpServer.resolveError` (`HttpServer.ts:217-256`) → an
  `HttpResponse` the adapter writes. Middleware errors: `next(err)` → Express error sink
  (`HttpServer.ts:281-323`) → same registry → same writer. Two roads to the same place.
- `transformResponse` runs inside the writer, synchronously, before rendering
  (`ExpressResponseWriter.ts:79-108`).
- A stream commits status and headers with its first chunk (`ExpressResponseWriter.ts:208-247`); a
  client disconnect calls `return()` on the source.
- `RequestLogger` times the request with `res.on('finish')` (`RequestLogger.ts:21-29`); it is mounted
  as a plain Express middleware (`HttpServer.ts:104-106`), not through the registry.
- Memory baseline (Node 26, server side, 2000 pending requests, Appendix A.5): a pending request on
  plain `node:http` holds ≈ 4.7 KB heap and ≈ 20 KB RSS; on Express ≈ 6.3 KB heap. Every number
  below is _on top of_ that.

### 1.2 The four middleware used in every idea

All code assumes the `RequestContext` from the queued plan (`.plans/refactor/queued/async-middleware.md`,
D2): `ctx.appInfo`, `ctx.response.setHeader()` (staged headers merged into whatever response is
written, errors included), `ctx.logger`, `ctx.signal`. `HttpResponse` is `src/services/http/responses.ts`.

```ts
// shared by the examples
import { AsyncLocalStorage } from 'node:async_hooks';
export const currentUser = new AsyncLocalStorage<AppUser>(); // a middleware's OWN store (M3)
export const getCurrentUser = () => currentUser.getStore();
// db.startSession() → { startTransaction(), commitTransaction(), abortTransaction(), endSession() }
```

- **M1 Role** — the user must have one of `params.roles`; otherwise throw `ForbiddenError`.
- **M2 Timing** — add `Server-Timing: total;dur=12.3` to the response (needs the moment the handler
  answered) and log the duration _after the last byte was sent_.
- **M3 CurrentUser** — take `ctx.appInfo.user` (set earlier by `GetUserByToken`) and make it
  readable through `getCurrentUser()` in later middleware, the handler and deep code that never
  receives `ctx`.
- **M4 Transaction** — start a DB session, run the rest, commit when the handler returned, roll back
  when it threw; deep code reaches the session through `ctx.appInfo.session` or a store.

Legend for the ASCII walks: `→` request direction, `◄` response direction, `[frame]` = a suspended
async function that stays in memory while the handler runs.

---

## 2. Ideas

### 2.1 Idea A — request-only (linear) + `ctx.onFinish`

**Idea.** `middleware(ctx)`: return nothing to continue, return an `HttpResponse` to stop, throw to
reach the error registry. Nothing runs after the handler except callbacks registered with
`ctx.onFinish(cb)`, which fire after the last byte (or disconnect).

```
Timing     → start t0, onFinish(log)
Role       → ok
CurrentUser→ (cannot wrap: enterWith only works before its first await)
Transaction→ (cannot wrap)
handler    → HttpResponse.json(201, order)
runner     → registry (if thrown) → transformResponse → staged headers → write ─► bytes ─► onFinish
```

```ts
class Role extends AbstractMiddleware {               // M1
  async middleware(ctx) {
    const user = ctx.appInfo.user;
    if (!user) throw new UnauthorizedError({ code: 'AUTH001', ... });
    if (!user.roles?.some((r) => this.params.roles.includes(r)))
      throw new ForbiddenError({ code: 'NO_ACCESS', ... });
  }
}
class Timing extends AbstractMiddleware {             // M2 — only half of it
  async middleware(ctx) {
    const t0 = performance.now();
    // Server-Timing header: IMPOSSIBLE here, the duration is known only after the handler
    ctx.onFinish(({ status }) => ctx.logger.info(`${status} ${performance.now() - t0}ms`));
  }
}
class CurrentUser extends AbstractMiddleware {        // M3 — only the framework store works
  async middleware(ctx) {
    // currentUser.run(user, …) has nothing to wrap; enterWith(user) works only if `user` is
    // already known synchronously (it is: GetUserByToken ran before). Fragile: one `await`
    // before enterWith and it silently stops working (Appendix A.1).
    currentUser.enterWith(ctx.appInfo.user);
  }
}
class Transaction extends AbstractMiddleware {        // M4 — IMPOSSIBLE
  async middleware(ctx) {
    ctx.appInfo.session = await db.startSession();    // who commits? who rolls back on throw?
    ctx.onFinish(async ({ status }) => status < 400 ? commit() : abort()); // after the bytes
  }                                                    // left the server: a 500 may already have
}                                                      // been sent for data that was then rolled back
```

**Requirements.** R1 ✅ · R2 ❌ (no response-dependent headers, no replacing) · R3 ✅ · R4 ⚠️
(framework store yes; own store only via `enterWith`, which Node documents as experimental and which
breaks after any `await`) · R5 ❌ (a span can parent the handler only through framework-published
`diagnostics_channel` hooks) · R6 ❌ · R7 ✅ best · R8 ✅.

**Cost (Node 26, 10 middleware, request pending in the handler).** ≈ 0–290 B per request (the
runner tail-calls the handler, so no frame stays). Dispatch ≈ 0.8 µs for 10 middleware. Streaming:
same as every "write after the chain" model (Appendix A.3).

**Pitfalls.** The gap is not the memory, it is that three requirements cannot be met. Everyone who
ships this model bolts hooks on afterwards: Express `on-headers` monkey-patches `res.writeHead`
(`on-headers/index.js:62-72`), `on-finished` adds listener machinery (`on-finished/index.js:106-116`),
Plug uses `register_before_send` (`plug/lib/plug/conn.ex:1887-1895`), h3 v1 had `onBeforeResponse`.

**Market.** Express 5 / pillarjs router (`router/index.js:189`, `router/lib/layer.js:157-184`),
Plug (pipeline compiled at build time, `plug/lib/plug/builder.ex:336-345`), Next.js `proxy`, our v1.

### 2.2 Idea B — onion with safe defaults (every middleware gets `next`)

**Idea.** `middleware(ctx, next)`. Not calling `next` and returning nothing → the runner calls it
for you (request-only middleware stay one-liners). `const response = await next()` runs the rest
and gives its response back. Return a branded `HttpResponse` to stop or replace. This is Koa/Hono
with React Router's auto-`next`.

```
                 IN                                        OUT
Timing      t0 ── await next() ──────────────────┐   ┌─► header, return response   [frame]
Role        ok (never mentions next)              │   │
CurrentUser return currentUser.run(user, next) ───┤   ├─ (store scope ends here)   [frame]
Transaction try { r = await next(); commit } ─────┤   ├─ catch → abort; rethrow    [frame]
handler     ────────────────────────────────────────┴─► HttpResponse.json(201)
runner      registry (if the top rejected) → transformResponse → write → onFinish
```

```ts
class Role extends AbstractMiddleware {
  // M1 — identical to Idea A (ignores next)
  async middleware(ctx) {
    /* same body as 2.1 */
  }
}
class Timing extends AbstractMiddleware {
  // M2
  async middleware(ctx, next) {
    const t0 = performance.now();
    try {
      return await next();
    } finally {
      ctx.response.setHeader(
        'Server-Timing',
        `total;dur=${(performance.now() - t0).toFixed(1)}`,
      );
      ctx.onFinish(({ status }) =>
        ctx.logger.info(`${status} ${performance.now() - t0}ms`),
      );
    }
  }
}
class CurrentUser extends AbstractMiddleware {
  // M3
  async middleware(ctx, next) {
    return currentUser.run(ctx.appInfo.user, next); // later middleware, handler, services all inside
  }
}
class Transaction extends AbstractMiddleware {
  // M4
  async middleware(ctx, next) {
    const session = await db.startSession();
    session.startTransaction();
    ctx.appInfo.session = session;
    try {
      const response = await next(); // rejects if the handler threw (see §4 rule 3)
      await session.commitTransaction();
      return response;
    } catch (err) {
      await session.abortTransaction();
      throw err; // the registry turns it into the 4xx/5xx
    } finally {
      await session.endSession();
    }
  }
}
```

**Requirements.** R1 ✅ (with auto-next) · R2 ✅ · R3 ✅ (onFinish) · R4 ✅ · R5 ✅
(`context.with(…, next)`, Appendix A.4 `/onion`) · R6 ✅ · R7 ⚠️ most memory and most rules ·
R8 ✅.

**Cost (Appendix A.2).** Pending in the handler, 10 middleware of which 2 wrap: **3.4 KB** per
request (Node), 1.7 KB (Bun); all 10 wrap: 10.7 KB. With 0 wrapping: still ≈ 1 KB, because the
recursive runner keeps one promise chain per layer. A flat-loop variant ("BL": the runner loops and
recurses only when a layer actually calls `next()`) brings 0-wrap to ≈ 0 B and 2-wrap to 2.8 KB; it
cannot go lower, because the runner must `await` each layer to see whether it returned a response.
Dispatch 1.3 µs (10 request-only) to 1.8 µs (2 wrap) per request. Streaming: equal to the others
when the write happens after the chain (Appendix A.3).

**Pitfalls (all reproduced, Appendix A.6).**
- `next()` called but not awaited, then an own response returned → the handler still runs (side
  effects happen) and its response is dropped. No runner can prevent it; it can only warn.
- `next()` not awaited and the handler throws → an `unhandledRejection` in a naive runner
  (koa-compose production build has no guard, `compose/index.js:7-16`). A runner that keeps the
  downstream promise and awaits it avoids this.
- `next()` not awaited, nothing returned → naive: the client gets no response (Koa's famous 404,
  `koa/docs/troubleshooting.md:12-53`); the safe runner waits for the downstream promise.
- Double `next()` → naive compose runs the handler twice; the safe runner throws at the second call
  (Hono `compose.ts:33-35`, React Router `router.ts:6586-6588`); AdonisJS ignores it
  (`poppinss-middleware/src/runner.ts:18-31`).
- Who sees the handler's error: Koa lets it reach outer `try/catch` (`koa/docs/error-handling.md:3-16`);
  Hono (`compose.ts:49-57`, `context.error`), SvelteKit and React Router (`router.ts:6603-6606`) turn
  it into a response at the innermost layer so an outer `catch` never runs. **For M4 that choice is
  dangerous: `try { await next() } catch { rollback }` silently commits** (scenario 5). See §4 rule 3.
- A `finally` runs when the chain unwinds, which for a _lazy stream_ is before the first byte is read
  (scenario 6): a transaction cannot cover a stream body. Same in every model; see §4 rule 6.

**Market.** Koa (`compose/index.js`; write after unwind `koa/lib/application.js:215-222`), Hono
(`hono/src/compose.ts:32-71`; its Server-Timing middleware is exactly M2:
`hono/src/middleware/timing/timing.ts:85-113`), AdonisJS (`poppinss-middleware/src/runner.ts:84-96`),
SvelteKit `sequence` (`kit/packages/kit/src/exports/hooks/sequence.js:83-140`), React Router
(`react-router/packages/react-router/lib/router/router.ts:6553-6630`, auto-next at 6621-6624),
NestJS interceptors (`nest/packages/core/interceptors/interceptors-consumer.ts:25-35`), Fresh, Astro,
Go `net/http` wrappers, axum layers, Spring WebFlux filters.

### 2.3 Idea C — per-middleware `onRequest` / `onResponse` methods

**Idea.** A class has `onRequest(ctx)` and optionally `onResponse(ctx, response)`. The runner walks
request methods forward, then the response methods of the middleware that ran, backwards, for every
response (early stops and errors included). No `next`. State between the two halves goes through
`ctx`.

```
Timing.onRequest      → ctx.state.t0 = now
Role.onRequest        → ok
CurrentUser.onRequest → (nothing to wrap)
Transaction.onRequest → session started, stored on ctx
handler               → response (or throw → registry → response)
Transaction.onResponse◄ status < 400 ? commit : abort      (reads the response, not the error)
Timing.onResponse     ◄ Server-Timing header; onFinish(log)
runner                → transformResponse → write → onFinish
```

```ts
class Timing extends AbstractMiddleware {
  // M2
  async onRequest(ctx) {
    ctx.state.t0 = performance.now();
  }
  async onResponse(ctx, response) {
    ctx.response.setHeader(
      'Server-Timing',
      `total;dur=${performance.now() - ctx.state.t0}`,
    );
    ctx.onFinish(({ status }) => ctx.logger.info(`${status}`));
    return response;
  }
}
class CurrentUser extends AbstractMiddleware {
  // M3 — only the framework store (same limit as A)
  async onRequest(ctx) {
    currentUser.enterWith(ctx.appInfo.user);
  }
}
class Transaction extends AbstractMiddleware {
  // M4 — works only by reading the status
  async onRequest(ctx) {
    ctx.state.session = await db.startSession();
    ctx.state.session.startTransaction();
  }
  async onResponse(ctx, response) {
    if (ctx.error || response.status >= 400)
      await ctx.state.session.abortTransaction();
    else await ctx.state.session.commitTransaction();
    await ctx.state.session.endSession();
    return response;
  }
}
```

**Requirements.** R1 ✅ · R2 ✅ · R3 ✅ · R4 ⚠️ framework store only · R5 ❌ (a span opened in
`onRequest` is a _sibling_ of the handler's spans, Appendix A.4 `/c2-want-parent`) · R6 ⚠️
("finally" yes, "the handler threw" only as `ctx.error`/status; no shared locals, no `try`) ·
R7 ✅ good · R8 ✅.

**Cost.** 2 wrapping of 10: ≈ 0.95 KB per pending request (Node). Two methods per class means two
`await`s per wrapping middleware per request; dispatch ≈ 1.2 µs.

**Pitfalls.** Every framework with named stages has a divergence somewhere: Fastify's last-resort
error handler skips `onSend` (`fastify/lib/error-handler.js`), its `hookIterator` silently stops
when `reply.sent` (`hooks.js:410-413`); Elysia skips `afterHandle` on error (`compose.ts:1725-1762`
runs it only on the normal path); hapi's `onPreResponse` "always runs" (`hapi/API.md:3697-3702`) but
its own transmit errors do not re-enter it; NestJS filters bypass interceptors. Spring's
`HandlerInterceptor.postHandle` is skipped on exceptions while `afterCompletion` always runs (public
API; not read from source here). The response method cannot use locals of the request method, so
every pair invents its own `ctx.state` keys.

**Market.** Fastify hooks (`onRequest → preHandler → onSend → onResponse`, `fastify/lib/hooks.js:230-325`,
`reply.js:565-576, 1004-1019`), hapi lifecycle (`hapi/lib/request.js:383-411, 442-479, 513-535`),
Elysia (`beforeHandle / afterHandle / mapResponse / afterResponse`, `elysia/src/compose.ts:1725-1793`),
Spring `HandlerInterceptor`, ASP.NET `IActionFilter.OnActionExecuting/OnActionExecuted`.

### 2.4 Idea D — stages + `ctx.onResponse` / `ctx.onFinish` callbacks (the "C2" of the earlier review)

**Idea.** Same linear `middleware(ctx)` as A, plus two registration points on the context:
`ctx.onResponse(hook)` runs before the write, newest first, for every response, may return a
replacement; `ctx.onFinish(hook)` after the last byte. The after-logic is a closure, so it shares
locals with the request part.

```
Timing      → t0; ctx.onResponse(r => add header); ctx.onFinish(log)
Role        → ok
CurrentUser → enterWith only (nothing to wrap)
Transaction → session; ctx.onResponse(r => ctx.error ? abort : commit)
handler     → response | throw → registry → response
runner      → onResponse hooks (newest first) → transformResponse → write → onFinish hooks   [frame]
```

```ts
class Timing extends AbstractMiddleware {
  // M2 — natural
  async middleware(ctx) {
    const t0 = performance.now();
    ctx.onResponse((response) => {
      ctx.response.setHeader(
        'Server-Timing',
        `total;dur=${performance.now() - t0}`,
      );
      return response;
    });
    ctx.onFinish(({ status }) =>
      ctx.logger.info(`${status} ${performance.now() - t0}ms`),
    );
  }
}
class Transaction extends AbstractMiddleware {
  // M4 — the error is a flag, not a catch
  async middleware(ctx) {
    const session = await db.startSession();
    session.startTransaction();
    ctx.appInfo.session = session;
    ctx.onResponse(async (response) => {
      if (ctx.error) await session.abortTransaction();
      else await session.commitTransaction();
      await session.endSession();
      return response;
    });
  }
}
// M1 as in A. M3: framework store only (requestContext().appInfo.user); own store impossible.
```

**Requirements.** R1 ✅ · R2 ✅ · R3 ✅ · R4 ⚠️ framework store only (`als.run` has nothing to
wrap; `enterWith` fragile; Appendix A.1 and the `als-stages.mjs` table in
`middleware-flow-models.md`, re-checked) · R5 ❌ (same sibling-span gap as C; fixable only by
framework `diagnostics_channel` spans, which then parent the _handler_, not the middleware's span)
· R6 ⚠️ (`finally` yes; "when the handler throws" = `ctx.error` check; a hook that throws cannot
rethrow _the handler's_ error) · R7 ✅ good · R8 ✅.

**Cost.** 2 of 10 register hooks: **1.3 KB** per pending request (Node), 0.77 KB (Bun); 10 of 10:
2.1 KB. Note ≈ 0.9 KB of that is the runner frame itself, which must `await` the handler to run the
hooks afterwards (in A the runner tail-calls the handler and keeps nothing). Dispatch ≈ 1.3 µs.

**Pitfalls.** Hooks run outside the request part's async context — a hook registered inside
`als.run` runs _outside_ the store (verified: Appendix A.6 scenario 7, `onResponseHook`/`onFinishHook`
undefined). Ordering of hooks vs `transformResponse` vs staged headers needs a rule. A hook
registered after the response was decided must throw. The "error as a flag" style is one more
thing to teach, and `ctx.error` is still set when the registry turned a 404 into a normal response.

**Market.** Closest: Plug `register_before_send` (`conn.ex:1887-1895`), Express `on-headers`,
hapi `request.events`, ASP.NET `Response.OnStarting`, AdonisJS `response.onFinish`. No major
framework uses this as its _only_ post-handler mechanism.

### 2.5 Idea E — stages + `ctx.runInside(wrap)` (the "C2W" of the earlier analysis)

**Idea.** Idea D plus `ctx.runInside((next) => …)`: a stage middleware registers a wrapper; the
runner applies all wrappers around the handler (and the response hooks). Wrapping is paid only by
requests whose middleware asked for it.

```
CurrentUser → ctx.runInside(next => currentUser.run(user, next))
Role        → ok     (NOT inside the store: wrappers apply later)   ← the gap
Transaction → ctx.runInside(async next => { try { r = await next(); commit; return r } catch { abort; throw } })
runner      → wrappers nest → handler → unwrap → onResponse hooks → write → onFinish
```

```ts
class CurrentUser extends AbstractMiddleware {
  // M3
  async middleware(ctx) {
    ctx.runInside((next) => currentUser.run(ctx.appInfo.user, next));
  }
}
class Transaction extends AbstractMiddleware {
  // M4 — real try/catch, but written as a callback
  async middleware(ctx) {
    ctx.runInside(async (next) => {
      const session = await db.startSession();
      session.startTransaction();
      ctx.appInfo.session = session;
      try {
        const r = await next();
        await session.commitTransaction();
        return r;
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        await session.endSession();
      }
    });
  }
}
// M1 as in A; M2 as in D.
```

**Requirements.** R1 ✅ · R2 ✅ · R3 ✅ · R4 ⚠️ **the store does not reach later middleware**,
only the handler and hooks (verified, Appendix A.7: `laterMiddleware: "nothing"`); to fix it the
runner would have to stop its loop and recurse at the point of registration — which is Idea G ·
R5 ✅ (handler only) · R6 ✅ · R7 ⚠️ two mechanisms (hooks and wrappers) with an ordering
relationship between them · R8 ✅.

**Cost.** 2 of 10: 1.4 KB (timing hooks) / **1.8 KB (ALS wrappers)** per pending request — heavier
than G for the ALS case, because the wrapper closures and the array are allocated per request and
the stage frames stay.

**Pitfalls.** Two ways to do after-work (hook vs wrapper) and they interleave; a wrapper registered
by a later middleware nests _inside_ an earlier one — fine — but `onResponse` hooks run inside all
wrappers or outside all of them, never in between. Harder to explain than one `around`.

**Market.** No framework has exactly this; the nearest is ASP.NET `IEndpointFilter` registered per
endpoint and h3's `onResponse(hook)` helper, which is really an onion layer (`h3-src/src/utils/middleware.ts:23-35`).

### 2.6 Idea F — h3-style hybrid as is (any value stops; `next` optional and memoized)

**Idea.** `middleware(event, next)`: return `undefined` → the runner calls `next()` for you; return
anything else → that is the response; `next()` may be called at most once and returns the memoized
downstream result (`h3-src/src/middleware.ts:125-151`).

```
Role        → undefined → auto-next
Timing      → const r = await next(); add header; return r         [frame]
CurrentUser → return currentUser.run(user, next)                   [frame]
handler     → value
```

Code for M1–M4 is the same as Idea B. The difference is in two rules: **any** non-`undefined` return
stops (an arrow function that returns an expression by accident becomes the body), and staged
headers vanish on error responses unless listed in `errHeaders` (`h3-src/src/response.ts:208-213`).

**Requirements.** Same as B (all ✅ except R7 ⚠️). **Cost.** 2 of 10: 2.7 KB per pending request
(the per-layer closures composed at boot are cheaper than B's recursion but still keep a frame per
layer through the `.then` chain). **Pitfalls.** The "any value stops" rule is the one h3 users trip
on (`h3-src/docs/3.middleware.md`); our branded `HttpResponse.is()` check removes it, which turns F
into B. **Market.** h3 v2 only.

### 2.7 Idea G — hybrid by declaration: `middleware(ctx)` or `around(ctx, next)` (recommended)

**Idea.** A class declares what it is. `middleware(ctx)` is a _stage_: request-only, exactly as in
Idea A. `around(ctx, next)` is a _wrapper_: `next()` runs the rest of the chain (later stages, later
wrappers, validation, the handler) and resolves to the response the rest produced, or rejects with
the error the rest threw. The chain is composed **once per route at boot**: consecutive stages run in
one flat loop; each `around` nests the remainder. Only wrapping middleware pay for wrapping; a chain
with no `around` costs the same as Idea A.

```
boot:   compile([Timing(around), GetUser, Role, CurrentUser(around), Transaction(around), validate+handler])
        = Timing.around( loop[GetUser, Role] → CurrentUser.around( Transaction.around( handler ) ) )

request:
Timing.around      t0 ── await next() ─────────────────────────┐   ┌─► header; return r  [frame]
  GetUser          appInfo.user = …     (flat loop, no frame)  │   │
  Role             ok                   (flat loop, no frame)  │   │
  CurrentUser.around  return currentUser.run(user, next) ──────┤   ├─ scope ends        [frame]
    Transaction.around  try { r = await next(); commit } ──────┤   ├─ catch → abort     [frame]
      validate + handler ──────────────────────────────────────┴───► HttpResponse.json(201)
runner   (rejected? → registry → response, ctx.error) → transformResponse → staged headers
         → write ──► bytes ──► onFinish hooks
```

```ts
class Role extends AbstractMiddleware {              // M1 — unchanged from Idea A (and from today
  async middleware(ctx) {                            //       minus `res`/`next`)
    const user = ctx.appInfo.user;
    if (!user) throw new UnauthorizedError({ code: 'AUTH001', ... });
    if (!user.roles?.some((r) => this.params.roles.includes(r)))
      throw new ForbiddenError({ code: 'NO_ACCESS', ... });
  }
}
class Timing extends AbstractMiddleware {            // M2
  async around(ctx, next) {
    const t0 = performance.now();
    ctx.onFinish(({ status, aborted }) =>
      ctx.logger.info(`${ctx.method} ${ctx.route} ${status}${aborted ? ' aborted' : ''} ${(performance.now() - t0).toFixed(1)}ms`));
    try {
      return await next();                           // response of the rest; rejects on error
    } finally {                                      // runs for errors too …
      ctx.response.setHeader('Server-Timing',        // … and staged headers go on error responses
        `total;dur=${(performance.now() - t0).toFixed(1)}`);
    }
  }
}
class CurrentUser extends AbstractMiddleware {       // M3 — own store; later stages, handler, services
  async around(ctx, next) {                          //       and later `around`s all run inside
    return currentUser.run(ctx.appInfo.user, next);
  }
}
class Transaction extends AbstractMiddleware {       // M4 — literally try/catch/finally
  async around(ctx, next) {
    const session = await db.startSession();
    session.startTransaction();
    ctx.appInfo.session = session;                   // or: return sessionStore.run(session, …)
    try {
      const response = await next();
      await session.commitTransaction();
      return response;
    } catch (err) {
      await session.abortTransaction();
      throw err;                                     // registry decides the status later
    } finally {
      await session.endSession();
    }
  }
}
class Tracing extends AbstractMiddleware {           // R5 — the span parents the handler's spans
  async around(ctx, next) {
    const span = tracer.startSpan(`middleware ${ctx.route}`);
    try { return await context.with(trace.setSpan(context.active(), span), next); }
    catch (err) { span.recordException(err); span.setStatus({ code: SpanStatusCode.ERROR }); throw err; }
    finally { span.end(); }
  }
}
```

**Requirements.** R1 ✅ (stage = today minus two parameters) · R2 ✅ · R3 ✅ (`onFinish`) · R4 ✅
(own store reaches later middleware, handler, services — Appendix A.7; framework store as companion
§2.8.1) · R5 ✅ (Appendix A.4 `/onion` is the same mechanism) · R6 ✅ literally · R7 ✅ good:
memory equals the number of wrapping layers, rules apply only to `around` · R8 ✅.

**Cost (Appendix A.2).** 2 of 10 wrap: **1.9 KB** (timing) / **1.0–1.3 KB** (ALS) per pending
request on Node, 1.0 KB / 0.5 KB on Bun — about half of B, within 0.5 KB of D, and _less_ than E for
ALS. 0 wrap: ≈ 0 B (same as A). 10 of 10 wrap: 6.9 KB (B: 10.7 KB). Variants of the runner's
treatment of `around`'s return value: strict tail-call 1.9 KB, `.then` auto-bubble 2.2 KB, `await`
auto-bubble 2.6 KB (Appendix A.8). Dispatch: 1.4 µs per request for 10 middleware with 2 wrapping
(Node; linear floor 0.94 µs; Bun 2.2 µs vs 0.9 µs). Streaming: 2.1 KB per in-flight stream, equal to
A/B/D when the write happens after the chain (Appendix A.3).

**Pitfalls.** The `next()` misuse cases of B exist, but only inside `around`; the runner absorbs
them as in §4. A class that defines both methods is a boot error. Developers must learn one new
word (`around`). Streaming resource lifetime is the same as in every model (§4 rule 6).

**Market.** The split "request-only kind vs wrapping kind" is exactly NestJS guards vs interceptors
(`router-execution-context.ts:208` guards run first and only return a boolean,
`guards-consumer.ts:21-34`; interceptors wrap the handler, `interceptors-consumer.ts:25-35`), Spring
`HandlerInterceptor` vs servlet `Filter.doFilter(chain)`, ASP.NET `IActionFilter` vs
`IAsyncActionFilter(next)`. Compile-once composition: h3 v2 (`h3-src/src/h3.ts:122-130`,
`middleware.ts:105-110`), Plug (`builder.ex:336-345`), Elysia's per-route JIT, our own
`RouteRegistry` decision ("pre-compiled middleware chains", `.plans/refactor/reference/decisions.md:17`).

### 2.8 Other ideas (companions, variants, rejected alternatives)

**2.8.1 Framework-owned AsyncLocalStorage store (companion to any model — recommended).** The
adapter enters one store per request, synchronously, before the first middleware:
`requestStore.run(ctx, () => chain(ctx))`. Anyone calls `requestContext()` and reads
`ctx.appInfo.user`, `ctx.id`, `ctx.logger`. Middleware fill it by writing to `ctx` — no wrapping
needed. Cost measured earlier: +140–380 ns and +70–180 B per request. Market: Koa
`app.currentContext` (`koa/lib/application.js:189-199, 205-206`), AdonisJS `HttpContext.get()`
(`adonis-http-server/src/server/main.ts:485-489`, opt-in), Hono `contextStorage()`
(`hono/src/middleware/context-storage/index.ts`), SvelteKit `getRequestEvent()`, Fastify
`@fastify/request-context` (`als.run` in `onRequest`, then **re-entered at `preValidation`** because
Node loses the context across `req.emit('end')`, `frc/package/index.js:34-58` — a warning for our
Node adapter later: enter the store where the handler chain actually starts).

**2.8.2 Framework-published `diagnostics_channel` tracing channels (companion).** The runner wraps
each middleware and the handler in `tracingChannel('adaptivestone:…').tracePromise`. An OTel
subscriber uses `start.bindStore` to make its span active for the traced call. Zero dependency,
≈ 17 ns per call with no subscriber (measured earlier, `otel-diagnostics-channel.cjs`). It gives
_framework_ spans that parent the handler; it does not let a _middleware's_ span do so — that still
needs `around`. Belongs in the observability plan; precedent: AdonisJS
(`middleware_handler.ts:30-50`), Fastify `fastify.request.handler`, h3 `h3.request`, Express router.

**2.8.3 NestJS four-kind taxonomy (guards / interceptors / pipes / filters).** G is the two-kind
version; validation is already a framework stage and the registry plays "filter". Four kinds is more
to learn for no new capability here.

**2.8.4 App-level named lifecycle hooks (Fastify style: `app.addHook('onSend', …)`).** Useful for
cross-cutting plugins (compression, request id) but they are not route-scoped middleware. Can be
added later as sugar over G (`around` registered globally).

**2.8.5 Write inside the chain** (the writer as the innermost layer, so `await next()` returns after
the last byte). Rejected by measurement: 5.5 KB (onion) / 3.9 KB (G) per in-flight stream with 2
wrapping layers, 13 KB / 9 KB with 10, versus 2.1 KB when the write happens after the chain
(Appendix A.3). Koa (`application.js:215-222`), Hono, h3 and React Router all write after the chain.

**2.8.6 Handler-level wrapping (`withTransaction(handler)`, decorators).** For R4–R6 a route can wrap
its own handler instead of using middleware: `handler: withTransaction(async (req) => …)`. No runner
rules at all, but it is not reusable across a controller's routes the way `static middleware` is,
and nothing in the chain after it runs inside. Fine as a user pattern, not as the framework model.

**2.8.7 Express-mounted wrapping middleware (5.x stopgap).** An Express middleware mounted before the
adapter _can_ wrap the whole framework chain today (`als.run(store, next)` works because Express's
`next` is synchronous; Appendix A.1 `/express-level`). It knows nothing about the route, so it cannot
be scoped per controller, but it is a working escape hatch until G ships.

---

## 3. Comparison table

R1 request-only simple · R2 after-handler (headers / replace / time) · R3 after-send · R4 ALS
(framework store / own store reaching later middleware + handler) · R5 middleware span parents the
handler · R6 try/catch/finally around the rest · R7 low memory, few rules · R8 registry +
`HttpResponse` + writer + streams.

| Idea | R1 | R2 | R3 | R4 own store | R5 | R6 | R8 | Pending in handler, 2 of 10 wrap (Node / Bun) | 0 wrap | 10 wrap | In-flight stream | Dispatch 10 mw (Node) | Runner rules | Who does it |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A request-only + onFinish | ✅ | ❌ | ✅ | ❌ (enterWith only) | ❌ | ❌ | ✅ | 0.2 KB / 0.6 KB | 0 | — | 2.1 KB | 0.8 µs | 2 | Express, Plug, our v1 |
| B onion, safe defaults | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3.4 KB / 1.7 KB (flat loop 2.8) | 1.0 KB (flat 0) | 10.7 KB | 2.1 KB (write after) | 1.3–1.8 µs | 6 | Koa, Hono, Adonis, RR, SvelteKit |
| C onRequest/onResponse methods | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠️ flag | ✅ | 0.95 KB / — | ≈0.9 KB | — | 2.1 KB | 1.2 µs | 4 | Fastify, hapi, Elysia, Spring |
| D stages + ctx.onResponse/onFinish | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠️ flag | ✅ | 1.3 KB / 0.8 KB | 0.9 KB | 2.1 KB | 2.1 KB | 1.3 µs | 5 | (Plug before_send, on-headers) |
| E stages + ctx.runInside | ✅ | ✅ | ✅ | ⚠️ handler only | ✅ | ✅ | ✅ | 1.4 KB timing / 1.8 KB ALS | 0.9 KB | 2.4 KB | 2.1 KB | ≈1.4 µs | 7 | none |
| F h3 hybrid as is | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ any value stops | 2.7 KB / — | — | — | 2.1 KB | ≈1.5 µs | 4 | h3 v2 |
| **G hybrid by declaration** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **1.9 KB / 1.0 KB** (ALS 1.0–1.3 / 0.5) | **0** | 6.9 KB | 2.1 KB | 1.4 µs | 4 (only for `around`) | Nest guards/interceptors, Spring, ASP.NET |

"Runner rules" counts the things a developer must know beyond "return void / return response /
throw": A = onFinish timing, staged headers. B = auto-next, branded stop, double next, un-awaited
next, forgot return, errors (as response or thrown). G = the B rules but only inside `around`, plus
"one class, one kind".

For scale: 10 000 requests pending in handlers cost ≈ 47 MB of sockets and parsers on plain Node
(63 MB on Express). On top of that: A ≈ 2 MB, D ≈ 13 MB, **G ≈ 19 MB**, B ≈ 34 MB (2 wrapping of
10). Long streams cost ≈ 21 MB extra per 10 000 in every model when the write happens after the chain.

---

## 4. Recommendation and the rules it needs

**Choose G (hybrid by declaration) with two companions: the framework store (2.8.1) and
`ctx.onFinish`.** Reasons, in order:

1. It is the only model that meets R1–R8 with no asterisks and stays near the memory floor:
   a request-only chain costs nothing extra, and each wrapping middleware costs one suspended frame
   (≈ 0.5–0.9 KB), which is the true price of "around" in JavaScript — no model can wrap for less.
2. It needs the smallest set of rules that still covers wrapping: a stage has none (void / response
   / throw); the `next()` rules exist only inside `around`, and the class name tells the reader which
   kind it is. The B alternative puts `next` in every signature and forces the runner to inspect
   every layer's result (that is where B's extra 1–1.5 KB goes).
3. Composition at boot fits what the registry already does (chains are known per route) and gives
   codegen and tooling the list of wrapping middleware for free (OTel span names, docs).
4. D/E are cheaper only when nobody wraps; as soon as ALS or a transaction is needed they cost the
   same or more (E) and still miss parts of R4/R5/R6. C's two-method style has the "error as a flag"
   trap for transactions.

Do not add `ctx.onResponse`: `around` covers "before the write" (headers via `ctx.response.*`,
replace by returning a new response) and `onFinish` covers "after the bytes". Two mechanisms, not three.

### 4.1 The contract

```ts
abstract class AbstractMiddleware {
  /** Stage: runs before the rest. void → continue; HttpResponse → stop and answer; throw → registry. */
  middleware?(
    ctx: RequestContext,
  ): Promise<void | HttpResponse> | void | HttpResponse;
  /** Wrapper: `next()` runs the rest of the chain. Return its response or a new one. */
  around?(ctx: RequestContext, next: Next): Promise<HttpResponse | undefined>;
}
type Next = () => Promise<HttpResponse | undefined>;
```

A class defines **exactly one** of them (boot-time error otherwise). The framework's own
middleware are stages; none of them needs `around` today (`RequestLogger` moves its timing to
`onFinish`).

### 4.2 Rules for `next()`

1. **`next()` resolves to the response the rest of the chain produced**: the handler's returned
   `HttpResponse`, or the `HttpResponse` a later stage/wrapper returned to stop early. It resolves to
   `undefined` only when a 5.x legacy handler wrote `res` itself (nothing to see) or when the client
   aborted before the handler ran (§4.6).
2. **`next()` may be called once.** The second call throws synchronously
   (`"<Class>.around: next() called twice"`). An `around` that never calls `next` and returns no
   response → the runner continues the chain for it (auto-next, React Router `router.ts:6621-6624`),
   so a conditional wrapper (`if (!needTx) return; …`) cannot hang the request.
3. **`next()` rejects with the original error** when the rest threw (Koa semantics,
   `koa/docs/error-handling.md:3-16`). This is what makes `try { await next() } catch { rollback }`
   correct by construction. Hono/React Router's "next never throws, read `ctx.error`" was rejected
   because a transaction middleware written the natural way would silently commit (Appendix A.6
   scenario 5). An `around` that wants to _replace_ an error response catches and returns its own
   `HttpResponse`, or rethrows a different error.
4. **Return value.** `HttpResponse` → that is the response of this layer (own or downstream's). Any
   other value (including `undefined`) → the downstream response is used (auto-bubble, via `.then`,
   +150 B per layer; or strict tail-call if the maintainer prefers, Appendix A.8). A value that is
   neither `undefined` nor branded → warn once per class in development.
5. **`next()` called but not awaited, then an own response returned** → the runner awaits the
   dangling promise (so a handler error cannot become an `unhandledRejection`), sends the returned
   response, and warns once per class. Not awaited and nothing returned → the runner waits for the
   downstream promise and sends its response (scenario 3).
6. **Throwing in the after-part** replaces the response with the error (plain JavaScript semantics).
   Document it; do not special-case.

### 4.3 Order of one request

```
adapter: match route → ctx (same Express req in 5.x) → requestStore.run(ctx, …)   ← framework store
  compiled chain:
    stages (flat loop)  → first around → stages → … → validation → handler
  ◄ unwind: each around's after-part, innermost first
registry: if the top rejected → resolveError(err, ctx) → HttpResponse (else 500); ctx.error = err
          (exactly once, at the top; `around`s saw the raw error, not the response)
transformResponse (project hook, inside the writer as today)
writer: staged headers (ctx.response.*) merged into the response — errors included (D2.4) → render
        → stream chunks …
onFinish hooks: after res 'finish' or 'close', with { status, aborted, durationMs }, read-only,
        newest first, each in its own try/catch (one hook's error is logged, the others still run)
```

Error resolution happens once and at the top. An `around` that wants to put a header on a 404 uses
`finally` + `ctx.response.setHeader` (staged headers are applied to every response). An `around`
that wants to log the final status uses `onFinish` (it gets the real one, after the registry).
Errors thrown _by the writer_ before headers are sent (a body that cannot be serialized, a stream
that fails before the first chunk) are resolved through the registry and written as today
(`ExpressResponseWriter.ts:52-76` already restores the headers it found); after headers are sent
they are logged and the response is destroyed, as today.

### 4.4 Streaming and resource lifetime

The chain unwinds when the handler _returns_ the `HttpResponse`, before the first byte of a stream
is read (measured and demonstrated: Appendix A.3 and A.6 scenario 6). So:

- An `around`'s after-part sees the stream _descriptor_ (can add headers, wrap or replace the body),
  never the bytes.
- A resource owned by an `around` (a transaction, a lock) **is not alive while a lazy stream body
  runs.** Rule, in the docs and in the `Transaction` example: if `response.kind === 'stream'` (or
  `'native'` with a body) and the body depends on the resource, either the handler collects the data
  inside the transaction and streams a buffer, or the middleware moves release to `ctx.onFinish`
  (commit-after-send, which means a failed stream cannot roll back — say so). A sentence in the docs
  is enough; a runtime detector ("an `around` unwound while the response is a stream") would warn on
  every harmless Timing or CurrentUser wrapper too, so I do not recommend one (open question 5.7).
- Keeping the frames alive through the stream ("write inside the chain") was measured at
  +1.7 KB per wrapping layer per in-flight stream (onion) and rejected (2.8.5).

### 4.5 Client abort

`ctx.signal` aborts on `res 'close'` without `finish`. The runner checks `ctx.signal.aborted` before
each stage, each `around` and the handler, and before writing. When aborted it returns `undefined`
up the chain (so `around` after-parts and `finally` blocks still run and a transaction commits or
rolls back on what the handler actually did), writes nothing, and runs `onFinish` with
`aborted: true`. A middleware or handler that wants to stop _its own_ work early listens to
`ctx.signal` (React Router does the per-layer check: `router.ts:6569-6574`).

### 4.6 5.x compatibility with `middleware(req, res, next)` classes

- Keep the queued plan's `static get contractVersion(): 1 | 2` (default 1). A v2 class has
  `middleware(ctx)` or `around(ctx, next)`; a v1 class keeps the Express bridge
  (`runMiddleware` as it is today). The compiler treats a v1 entry as a stage: the bridge promise
  resolves → continue; `res.writableEnded` → stop; rejection → error.
- In 5.x `ctx` is the Express request (option c of D2), so a v1 stage and a v2 stage see the same
  `appInfo`. A v2 `around` wraps v1 stages too (they run inside `next()`), which already makes
  `als.run` work for everything behind it.
- A v2 `around` whose `next()` resolves `undefined` because a legacy handler answered through `res`
  can only log; document it (same limit as `transformResponse` today).
- Built-ins stay v1 through 5.x for the subclass reason the plan gives; `RequestLogger` is global
  Express middleware and can switch to `onFinish` whenever `ctx.onFinish` exists.
- Alternative worth a thought (open question 5.3): detect v2 by method name instead of a flag, so
  built-ins can migrate during 5.x without breaking subclasses that still override
  `middleware(req, res, next)`.

### 4.7 Runner sketch (TypeScript, the whole thing)

```ts
type Compiled = (ctx: RequestContext) => Promise<HttpResponse | undefined>;

/** Composed once per route at boot. */
function compile(
  chain: MiddlewareEntry[],
  i: number,
  runHandler: Compiled,
): Compiled {
  const stages: Stage[] = [];
  let j = i;
  while (j < chain.length && !isAround(chain[j])) stages.push(chain[j++]);
  const wrapper = j < chain.length ? (chain[j] as Around) : null;
  const inner = wrapper ? compile(chain, j + 1, runHandler) : null;

  return async (ctx) => {
    for (const stage of stages) {
      if (ctx.signal.aborted) return undefined;
      const r = await stage.middleware(ctx); // throw → propagates to the top
      if (HttpResponse.is(r)) return r; // stop; anything else: continue
    }
    if (!wrapper) return runHandler(ctx); // tail call: no frame kept
    if (ctx.signal.aborted) return undefined;
    let downstream: Promise<HttpResponse | undefined> | undefined;
    const next = () => {
      if (downstream)
        throw new Error(`${wrapper.name}.around: next() called twice`);
      return (downstream = inner!(ctx));
    };
    return Promise.resolve(wrapper.around(ctx, next)).then(
      (r) => {
        if (HttpResponse.is(r)) {
          if (downstream) {
            warnOnce(wrapper, 'returned a response without awaiting next()');
            return downstream.then(
              () => r,
              () => r,
            );
          }
          return r;
        }
        return downstream ?? inner!(ctx); // forgot return → bubble; never called next → continue
      },
      (err) => {
        if (downstream) downstream.catch(() => {});
        throw err;
      }, // no dangling rejection
    );
  };
}

async function dispatch(
  ctx: RequestContext,
  compiled: Compiled,
  writer: ResponseWriter,
) {
  let response: HttpResponse | undefined;
  try {
    response = await requestStore.run(ctx, () => compiled(ctx));
  } catch (err) {
    ctx.error = err;
    response = await resolveErrorOr500(ctx, err); // registry; logged at the entry's level
  }
  if (ctx.signal.aborted || response === undefined) return finish(ctx); // legacy res / abort
  try {
    await writer.write(response, ctx); // transformResponse → staged headers → render
  } catch (err) {
    if (!ctx.headersSent)
      await writer.write(await resolveErrorOr500(ctx, err), ctx);
    else ctx.logger.error(err);
  }
  // onFinish hooks are attached to res 'finish'/'close' the first time ctx.onFinish is called
}
```

Memory of this runner per pending request: stages before the first `around` keep nothing (tail
call), each `around` keeps its own frame plus one `.then` reaction (Appendix A.8: 2.2 KB for 2 of 10
on Node, 1.25 KB on Bun), plus the `dispatch` frame that every model needs to write after the chain.

---

## 5. Open questions for the maintainer

1. **Strict or forgiving `around`?** Strict (the runner trusts `around` to return the response;
   1.9 KB) versus auto-bubble through `.then` (2.2 KB; a forgotten `return` still answers). I
   recommend forgiving, because the failure mode of strict is "request answered with nothing".
2. **`next()` rejects (Koa) — confirmed?** It is the rule that makes M4 safe. The price: an
   `around` that wants to _see the error response_ must use `onFinish` or `finally` + staged headers.
3. **v2 detection:** `static contractVersion = 2` (plan, approved) or by method name (`around` /
   one-argument `middleware`), which would let built-ins migrate in 5.x. The flag is simpler to
   explain; the method name needs no flag but needs a rule for subclasses that still override
   `middleware(req, res, next)`.
4. **Framework store on by default?** +140–380 ns and ≈ 0.1 KB per request. Koa and AdonisJS make
   it opt-in; SvelteKit and Fastify's plugin are always on when installed. I would turn it on: it is
   what makes `requestContext()` work in models, loggers and jobs with no middleware at all.
5. **Where does `transformResponse` sit relative to `around`?** Proposed: inside the writer, after
   the chain, as today — so an `around` sees the handler's response, not the transformed one. The
   other order (transform first) would let middleware see what the client sees; tell me if that is
   wanted.
6. **Should an `around` be allowed in the global (Express-level) position in 5.x?** Today global
   built-ins are plain Express middleware. A global `around` would have to run inside the adapter
   (after matching), i.e. become a registry entry at the root node. Probably yes, as sugar over
   `registerSubtree('/')`.
7. **Lazy streams inside a transaction:** documentation rule (my recommendation) or a runtime
   warning when an `around`'s `finally` runs while the response is a stream?
8. **Naming:** `around` (Spring/AOP word) vs `wrap` vs `handle`. `around` reads well next to
   `middleware`. The Timing example shows `onFinish` on `ctx`; `ctx.onResponse` is deliberately
   absent — confirm you do not want it.

---

## Appendix A — measurements (what was measured, how)

All runs: Node 26.12.1
(`/tmp/claude-0/-home-user-framework/9696e70e-b2d3-5bd7-b2c5-f119416e5a4d/scratchpad/node-v26.12.1-linux-x64/bin/node`)
and Bun 1.4.4, this container, 2026-11-01. Scripts in
`/tmp/claude-0/-home-user/9696e70e-b2d3-5bd7-b2c5-f119416e5a4d/scratchpad/fable-exp/`; the
repository copies in `.plans/refactor/reference/middleware-experiments/` were run unmodified where
named.

### A.1 AsyncLocalStorage with today's adapter (`als-today.ts`, unmodified)

| Inside a framework middleware today                                   | Node 26 | Bun 1.4.4 |
| --------------------------------------------------------------------- | ------- | --------- |
| `als.run(store, () => next())`                                        | nothing | nothing   |
| `als.enterWith(store)` before the first `await`                       | alice   | alice     |
| `als.enterWith(store)` after an `await`                               | nothing | nothing   |
| Express middleware mounted before the adapter, `als.run(store, next)` | alice   | alice     |

### A.2 Retained heap per request pending in the handler (`retained-plus.mjs` = repo

`retained-memory.mjs` + model BL; `--expose-gc`, 10 000 suspended requests, median of 5)

| Model                       | 10 mw, 0 wrap | 10 mw, 2 wrap (timing) | 2 wrap (own ALS store) | 10 wrap (timing) | Bun: 2 wrap timing | Bun: 2 wrap ALS |
| --------------------------- | ------------: | ---------------------: | ---------------------: | ---------------: | -----------------: | --------------: |
| A request-only + onFinish   |          13 B |                  223 B |                      — |                — |              608 B |               — |
| C2 (D) stages + hooks       |         896 B |                1 343 B |                      — |          2 129 B |              768 B |               — |
| C2W (E) stages + runInside  |             — |                1 424 B |                1 792 B |         2 449 B* |              800 B |               — |
| H (G) hybrid by declaration |     −39 B ≈ 0 |                1 864 B |          1 013–1 288 B |          6 880 B |            1 024 B |           496 B |
| BL onion, flat loop         |          13 B |                2 841 B |                2 624 B |         11 819 B |            1 584 B |         1 232 B |
| B onion, recursive          |         973 B |                3 398 B |                3 184 B |         10 720 B |            1 712 B |               — |
| D h3-style                  |             — |                2 696 B |                2 599 B |                — |                  — |               — |
| C1 (C) onRequest/onResponse |             — |                 952 B* |                      — |                — |                  — |               — |

`*` from the earlier run in `middleware-flow-models.md`, not repeated here. The harness suspends
requests inside the handler; it has no top-level `await` in the runner, so the `dispatch` frame that
every real model needs (to write after the chain) is not counted — it is the same for all models.
Why A ≈ 0 and C2 ≈ 0.9 KB with no wrapping: A's runner tail-calls the handler, C2's must `await` it
to run hooks afterwards; a suspended async runner frame with its locals costs ≈ 0.9 KB here.

### A.3 Retained heap per request that is actively streaming (`stream-retained.mjs`, 5 000 in-flight

streams whose first chunk is gated, median of 5)

| Model                                  | Node, 2 of 10 wrap | Node, 10 of 10 wrap | Bun, 2 of 10 wrap |
| -------------------------------------- | -----------------: | ------------------: | ----------------: |
| none (handler + writer only)           |            1 496 B |                   — |             678 B |
| stages (D)                             |            2 095 B |                   — |             678 B |
| onion, write **after** the chain       |            2 126 B |             1 951 B |             950 B |
| hybrid (G), write **after** the chain  |            2 113 B |             1 934 B |                 — |
| onion, write **inside** the chain      |            5 511 B |            12 950 B |           2 582 B |
| hybrid (G), write **inside** the chain |            3 920 B |             8 989 B |           1 910 B |

Writing after the chain makes streaming cost the same in every model; writing inside costs
≈ 1.7 KB (onion) / ≈ 0.9 KB (G) per wrapping layer for the life of the stream.

### A.4 OpenTelemetry span trees (`otel-stages.cjs`, unmodified, real OTel packages)

```
stages, middleware wants to parent the handler     stages + ctx.scope / onion / around
- POST /orders                                     - POST /orders
  - db insert order     ← sibling, not child         - transaction
  - transaction                                        - db insert order   ← child
```
`/c2-framework-wrap` (runner-owned spans) gives `middleware auth`, `middleware timing`,
`handler POST /orders` as children of the server span — framework spans, not the middleware's own.

### A.5 Baseline (`bench-mem/http-baseline.mjs`, 2 000 pending requests, server heap only)

plain `node:http`: +4 738 B heap, +19.8 KB RSS per pending request; Express 5: +6 331 B heap.

### A.6 Onion misuse and semantics (`onion-races.mjs`; identical on Node and Bun)

| #   | Case                                                                        | naive koa-compose runner                      | "safe" runner (B/G rules)                                                        |
| --- | --------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | `next()` not awaited, own 403 returned                                      | 403 sent, handler ran anyway                  | same, plus a warning                                                             |
| 2   | `next()` not awaited, handler throws                                        | 202 sent + **unhandledRejection**             | 202 sent, no unhandled rejection, `ctx.error` set                                |
| 3   | `next()` not awaited, nothing returned                                      | **no response at all**                        | 200 (downstream bubbled)                                                         |
| 4   | `next()` twice                                                              | handler ran **twice**                         | throws at the 2nd call → 500 via registry                                        |
| 5   | handler throws, `next()` **never throws** (Hono/RR rule)                    | —                                             | middleware `catch` did not run; `next()` resolved to 418                         |
| 6   | `try/finally` transaction, handler returns a lazy stream, write after chain | `tx closed → first chunk read, tx.open=false` | same (every model)                                                               |
| 7   | `als.run(store, next)` in a wrapping layer                                  | —                                             | handler ✅ service ✅ outer after-part ✅; hooks run after the chain see nothing |

### A.7 Does a later middleware see the store? (`c2w-gap.mjs`)

`C2W ctx.runInside: {"laterMiddleware":"nothing","handler":"alice"}` ·
`H around: {"laterMiddleware":"alice","handler":"alice"}` (Node and Bun).

### A.8 Three ways the G runner can treat `around`'s return value (`h-variants.mjs`, 2 of 10 wrap)

| Variant                                       | Node timing | Node ALS | Bun timing |
| --------------------------------------------- | ----------: | -------: | ---------: |
| strict tail-call (`return around(ctx, next)`) |     1 881 B |  1 288 B |    1 120 B |
| auto-bubble with `.then`                      |     2 183 B |  1 968 B |    1 248 B |
| auto-bubble with `await` in the runner        |     2 632 B |  2 416 B |    1 440 B |

### A.9 Dispatch CPU, no HTTP (`dispatch-bench-short.mjs` = repo script with 60 000 × 5; `dispatch-mini.mjs`)

Node 26, median ns per request, 10 middleware: linear 830 · phases 1 149 · onion 1 334 · **v1
bridge (today) 4 697**. With 2 wrapping of 10 (`dispatch-mini.mjs`): linear floor 937 · C2 1 266 ·
G 1 376 · BL 1 830. Bun: linear 888 · C2 1 354 · G 2 234 · BL 2 537. One framework request costs
≈ 45 µs at the last measured 22k req/s, so every v2 model is within ≈ 2 % of a request; the real
saving is v1 → any v2 (3–5×).

## Appendix B — source citations used above (clones under `…/scratchpad/repos/`)

koa-compose `compose/index.js:7-16` (production, no guards), `:39-66` (dev: double next, "resolved
before downstream") · Koa `koa/lib/application.js:189-199, 205-206` (ALS), `:215-222` (write after
unwind), `koa/docs/error-handling.md:3-16`, `koa/docs/troubleshooting.md:12-53` · Hono
`hono/src/compose.ts:32-71`, `hono/src/hono-base.ts:471-478`, `hono/src/middleware/timing/timing.ts:85-113`,
`hono/src/middleware/context-storage/index.ts` · h3 `h3-src/src/middleware.ts:105-110, 125-155`,
`h3-src/src/response.ts:208-213`, `h3-src/src/utils/middleware.ts:23-40`, `h3-src/src/h3.ts:85-93, 122-130`
· Fastify `fastify/lib/hooks.js:230-266, 278-325, 410-413`, `fastify/lib/route.js:392-398`,
`fastify/lib/reply.js:565-576, 1004-1019`; `@fastify/request-context` 7.0.5 `index.js:34-58` · hapi
`hapi/lib/request.js:383-411, 442-479, 513-535`, `hapi/lib/toolkit.js:80-82`, `hapi/API.md:3697-3702`
· AdonisJS `poppinss-middleware/src/runner.ts:18-31, 84-96`, `adonis-http-server/src/server/main.ts:474-489`,
`adonis-http-server/src/server/factories/middleware_handler.ts:30-50` · NestJS
`nest/packages/core/router/router-execution-context.ts:177-247`,
`nest/packages/core/guards/guards-consumer.ts:21-34`,
`nest/packages/core/interceptors/interceptors-consumer.ts:25-35, 98-101` · React Router
`react-router/packages/react-router/lib/router/router.ts:6553-6630` · Express/pillarjs
`router/lib/layer.js:157-184`, `router/index.js:189`, `on-headers/index.js:62-72`,
`on-finished/index.js:106-116` · Elysia `elysia/src/compose.ts:1725-1793` · SvelteKit
`kit/packages/kit/src/exports/hooks/sequence.js:83-140` · Plug `plug/lib/plug/builder.ex:336-345`,
`plug/lib/plug/conn.ex:1887-1895`. Spring and ASP.NET Core: public API knowledge, not read from source.
