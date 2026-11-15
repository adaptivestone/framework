# Middleware flow models (2026-10-31)

Input for [async-middleware D2.1](../queued/async-middleware.md). Which flow should the v2
middleware contract use: request-only (what we have), onion, separate request + response stages,
or a hybrid? Read from the **source code** of 14 frameworks (shallow clones of their current
default branches, Oct 2026) plus a dispatch-cost benchmark.

## The four models

| Model                                  | How it works                                                                                                        | Read in source                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Request-only (linear)**              | Middleware runs before the handler; continues or stops. Nothing runs "around" the handler.                          | Express 5 / pillarjs router, Plug, **our v1**                                                                                                   |
| **Onion**                              | One function wraps the handler: `const res = await next()`; code after it runs after the handler.                   | Koa, Hono, AdonisJS, SvelteKit, React Router, NestJS interceptors                                                                               |
| **Separate request + response stages** | Distinct hooks before and after the handler (`onRequest`… `onSend`, `beforeHandle`/`afterHandle`, `onPreResponse`). | Fastify, Elysia, hapi, NestJS guards (+ filters)                                                                                                |
| **Hybrid**                             | Return to continue or stop; optionally `await next()` to wrap.                                                      | h3 v2 (`src/middleware.ts:125-151` — `next()` is memoized and returns the downstream result; its own `onResponse`/`onError` helpers are onions) |

## What each model does well, and where it hurts (with source evidence)

### Request-only (linear)

- **Good:** cheapest and simplest. Plug's pipeline is unrolled at compile time
  (`plug/lib/plug/builder.ex:336-416`); stopping is a flag (`conn.ex:1906-1908`) or a return value.
  Moving our v1 to a linear v2 is mostly deletion: the v1 bridge allocates ≈5 closures, 4 promises
  and 4 EventEmitter operations per middleware per request (`ExpressAdapter.ts:164-217`).
- **Hurts:** middleware cannot wrap the handler (time it, transform the result, catch its errors).
  Every linear ecosystem bolts hooks on: Express `on-headers` monkey-patches `res.writeHead`
  (`on-headers/index.js:62-72`), `on-finished` adds listener machinery (`on-finished/index.js:92-178`),
  Plug uses `register_before_send` (`conn.ex:1888-1934`). Those hooks run in **reverse**
  registration order (on-headers README:35; `conn.ex:1872-1873`), which surprises people.
  Pitfalls: Express has no double-`next()` guard (`router/index.js:189`); a resolved async
  middleware that forgets `next()` hangs (`layer.js:172-178`).

### Onion

- **Good:** one function covers before, after and `finally` — timing, headers on the final
  response, session commit, compression (`hono/src/middleware/compress/index.ts:126`; React Router
  docs `how-to/middleware.md:440-446`). A deferred write lets outer layers still change status and
  headers, even for streams (Koa `lib/application.js:336-346`; AdonisJS `response.ts:1228-1238`).
  `try/catch` around `next()` keeps error mapping local (Koa `docs/error-handling.md:8-16`).
- **Hurts:**
  - **Missing `await` silently produces the wrong response** unless the framework detects it:
    Koa (`docs/troubleshooting.md:23-55`: body set too late → 404), AdonisJS (no detection;
    writes after the chain are ignored, `response.ts:1202-1204`); Hono adds a runtime check
    (`hono-base.ts:474-478`); React Router auto-calls `next()` and auto-bubbles a forgotten
    `return` (`router.ts:6616-6624`).
  - **Double `next()`** behaves differently everywhere: rejects (koa-compose 4.1 `index.js:36`),
    throws (Hono `compose.ts:33`), is ignored (AdonisJS `@poppinss/middleware runner.ts:20`), has no
    guard (koa-compose 4.2 production, SvelteKit), or is race-prone (React Router `router.ts:6585-6607`).
  - **Error semantics split:** Koa lets the real error reach outer layers; Hono, AdonisJS,
    SvelteKit and React Router turn it into a response at the innermost layer, so outer
    `try/catch` never sees it (Hono exposes it as `c.error`, `context.ts:318-333`). React Router
    makes `next()` never throw on purpose, so outer middleware (session commit) still runs.
  - Koa's error path drops every header set earlier (`lib/context.js:137-143`).
  - Cost: a closure, a promise and a stack frame per layer; Hono recomposes per request
    (`hono-base.ts:469`), AdonisJS builds a `new Runner` per request, SvelteKit adds an event copy
    and an AsyncLocalStorage run per layer.

### Separate request + response stages

- **Good:** response hooks run in one place for normal, early and error responses (Fastify
  `onSend` `reply.js:156-175`; Elysia `compose.ts:1725-1798`; hapi `onPreResponse` always runs,
  `API.md:3697-3702`). Serialization is deferred, so headers and status stay changeable until the
  write (Fastify `reply.js:599-711`; hapi `transmit.js:27`). Dispatch is cheap: empty stages are
  `null` (Fastify `route.js:392-398`) or emit no code (Elysia per-route JIT, `compose.ts:2128-2175`).
  A dedicated after-response hook is the clean metrics point (Fastify `onResponse` on `finish`).
- **Hurts:**
  - **Fragile early exit:** Fastify stops silently on `reply.sent` and async hooks must
    `return reply` (`hooks.js:410-413`, `docs/Reference/Hooks.md:347-357`); hapi pre-handler steps
    may only return `h.continue`, an error or a takeover (`request.js:404-408`), and `undefined`
    is a 500 (`toolkit.js:80-81`).
  - **No shared scope:** a request hook and a response hook cannot share locals or
    `try/finally` around the handler; state goes through the request (decorators, `ctx.state`).
  - **Error paths diverge:** Fastify's last-resort handler skips `onSend`
    (`error-handler.js:34-49`); Elysia skips `afterHandle` on errors; hapi does not re-run
    `onPreResponse` for its own transmit errors; NestJS filters bypass interceptors.
  - Large rule surface (hapi per-step return rules `API.md:3791-3826`; Elysia `mapResponse` behaves
    differently with and without `afterHandle`, `compose.ts:1911` vs `1951`).

### Hybrid (h3 v2)

- **Good:** request-only middleware stay one-liners; wrapping is available when needed;
  `next()` is memoized, so a double call is harmless (`middleware.ts:125-151`).
- **Hurts:** any non-`undefined` return ends the request — an arrow function that returns an
  expression by accident becomes the body (`docs 3.middleware.md:60-61`); staged headers vanish
  on errors unless listed in `errHeaders` (`response.ts:208-213`); two styles to learn.

## Streaming, in every model

After the first byte, nothing can change status or headers or report an error to middleware
(Koa `response.js:98`; Hono `stream.ts:26-44`; Fastify `reply.js:846-858`). Response-side code
only sees the stream **object** before it is written and can wrap or replace it; per-chunk access
is read-only (hapi `peek`) or framework-specific (SvelteKit `transformPageChunk`). Our writer
already commits headers with the first chunk, so a response-side middleware here sees the stream
descriptor before anything is sent.

## Dispatch cost (benchmark)

Minimal implementations of each model, Node 26.12.1, 200 000 requests × 7 runs, median ns per
request, no HTTP. (For scale: one framework request costs ≈45 µs at the last measured 22k req/s.)

| Middleware per request         |       Linear (v2) | Onion | Phases | **v1 bridge (today)** |
| ------------------------------ | ----------------: | ----: | -----: | --------------------: |
| 0                              |               239 |   146 |    238 |                   214 |
| 5 (request work only)          |               610 |   688 |    595 |             **1 936** |
| 10 (request work only)         |               789 | 1 334 |    882 |             **3 271** |
| 10 (work before **and** after) | 1 897 (+onFinish) | 1 982 |  2 183 |                     — |

All new models are within about 1 µs of each other at ten middleware — under 3% of a request. The
cost argument is v1 → any v2 (2.5–4× less dispatch time), not between the v2 models. Benchmark
source: kept outside the repository (session scratchpad), reproducible from the table's description.

## What this means for us

Our pieces already change the trade-offs:

- Handlers and the error registry produce **`HttpResponse` values** and one writer sends them.
  So "after the handler" code can work on an immutable response value (return a new one) instead
  of mutating a half-written response, and the "errors lose headers / skip the hook" divergences
  above are avoidable: every response, including error responses, passes the same point.
- Errors are already turned into responses by the registry. An onion `next()` or a response hook
  would naturally receive that response, with the original error on the context (the Hono / React
  Router / SvelteKit choice), so outer middleware still run for errors.
- During 5.x, handlers that write `res` themselves produce no response value; response-side
  middleware cannot see or change those responses (same limit as `transformResponse`).

## How option B walks (onion with safe defaults)

Route `POST /orders`, chain `Timing → GetUserByToken → Role → RateLimiter`, then validation and
the handler. Only `Timing` calls `next()`; the others are request-only and never mention it.

```
                 IN (request)                              OUT (response)
                 ────────────                              ──────────────
 Timing          t0 = now()  ── await next() ──┐   ┌──►  log status + (now - t0)
                                               │   │      return response
 GetUserByToken  ctx.appInfo.user = …          │   │     (no OUT part: never called next)
 Role            user has role? yes → continue │   │     (no OUT part)
 RateLimiter     budget left?   yes → continue │   │     (no OUT part)
 validation      body ok?       yes            │   │
 handler         ──────────────────────────────┴──►  return HttpResponse.json(201, order)
```

A request-only middleware (Role) is written exactly as today, minus `res` and `next`:

```ts
class Role extends AbstractMiddleware {
  async middleware(ctx) {
    if (!ctx.appInfo.user) throw new UnauthorizedError();
    if (!this.allows(ctx.appInfo.user)) throw new ForbiddenError();
    // return nothing → the chain continues
  }
}
```

Only a middleware that needs the response asks for it:

```ts
class Timing extends AbstractMiddleware {
  async middleware(ctx, next) {
    const t0 = performance.now();
    const response = await next(); //       everything further in runs here
    ctx.logger.info(
      `${ctx.method} ${ctx.route} ${response.status} ${performance.now() - t0}ms`,
    );
    return response; //                     or a new HttpResponse with an extra header
  }
}
```

### Edge cases

Role denies — the walk turns around at Role; layers that called `next()` still see the response:

```
 Timing        t0 ── await next() ──┐   ┌──►  logs 403 + time
 GetUser       set user             │   │
 Role          throw Forbidden ─────┴─► registry → HttpResponse 403
 RateLimiter   (not run)
 handler       (not run)
```

The handler throws — `next()` never throws; the error registry turns it into a response and the
original error is on `ctx.error`:

```
 Timing     t0 ── await next() ──┐   ┌──►  sees 404 (ctx.error = NotFoundError), logs, returns it
 …                               │   │
 handler    throw NotFoundError ─┴─► registry → HttpResponse 404
```

Streaming — the OUT part sees the stream response **before** the first byte, so headers can still
be added; the time measured is "until the handler answered". For "until the last byte", use
`ctx.onFinish(cb)`:

```
 Timing   t0 ── next() ──┐   ┌──► add header, return ──► writer sends headers + chunks … last byte
                         │   │                                                    └─► onFinish
 handler  return HttpResponse.stream(…) ┘
```

Legacy handler in 5.x writes `res` itself — there is no response value; `next()` resolves to
`undefined` and the bytes are already sent, so the OUT part can only log:

```
 Timing   t0 ── next() ──┐   ┌──► response === undefined → log only
 handler  res.json(...) ─┘   (already on the wire)
```

Mistakes the runner absorbs:

| Mistake                                               | What happens                                         |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Returns nothing and never calls `next` (request-only) | continue — this is the normal case                   |
| `await next()` but forgets `return`                   | the downstream response is passed on                 |
| `next()` without `await`, returns nothing             | the runner waits for it and passes it on             |
| Returns an object that is not an `HttpResponse`       | ignored (continue) — only the branded value stops    |
| Calls `next()` twice                                  | throws at the second call                            |
| Throws in the OUT part                                | the registry turns it into the response that is sent |

### Runner sketch (all of the above)

```ts
async function run(ctx, chain, i): Promise<HttpResponse | undefined> {
  if (i === chain.length) return runHandler(ctx); //      validation + handler + registry
  let downstream: Promise<HttpResponse | undefined> | undefined;
  const next = () => {
    if (downstream) throw new Error('next() called twice');
    downstream = run(ctx, chain, i + 1);
    return downstream;
  };
  let result: unknown;
  try {
    result = await chain[i].middleware(ctx, next);
  } catch (err) {
    return resolveError(ctx, err); //                     never throws outward
  }
  if (HttpResponse.is(result)) return result; //          stop, or replace downstream's response
  return downstream ?? run(ctx, chain, i + 1); //         forgot return / didn't call next
}
```

### What it gives us

- **Request → response timing per route** in one middleware (logging, the P1s metrics seam).
- **Tracing**: start a span on the way in, end it with the status on the way out (P2b).
- **Headers that depend on the result**: `Cache-Control`/`ETag` only on 200, deprecation headers,
  request id on every response.
- **Cache / idempotency**: on the way in return a stored response (short-circuit); on the way out
  store the new one.
- **Work around the handler**: `try/finally` (release a lock, commit or roll back a transaction,
  refresh a session cookie only when the handler succeeded).
- Request-only middleware (auth, roles, rate limits, i18n, pagination) stay as simple as today.

## Independent review (Fable, 2026-10-31)

Asked by the owner for a review not anchored on earlier recommendations. Verdict: **C2** —
request-only `middleware(ctx)` plus `ctx.onResponse(hook)` (before the write, newest first, every
response including early stops and errors, may return a replacement) and `ctx.onFinish(hook)`
(after the last byte or disconnect, read-only). B is judged over-engineered for this framework.

Retained heap per _pending_ request (Node 26.12.1, `--expose-gc`, 10 000 requests suspended in the
handler, 10 middleware of which 2 work before and after; reproduced independently):

|          A |    C1 |      **C2** |       D |       B |
| ---------: | ----: | ----------: | ------: | ------: |
| ≈ 25–290 B | 952 B | **1 350 B** | 2 696 B | 3 400 B |

With all 10 middleware wrapping: C2 ≈ 2.1 KB, B ≈ 10.8 KB. For scale, a pending request on plain
Node http holds ≈ 4.7 KB heap (Express ≈ 6.3 KB); at 10 000 concurrent streams B ≈ 34 MB, C2 ≈
13 MB, A ≈ 3 MB on top of ≈ 200 MB of sockets and parsers. B keeps a suspended async frame,
a promise and a `next` closure per wrapping layer for the request's whole life (long streams
included); C2 keeps one suspended runner frame plus one small closure per registered hook.

B's only unique capability is running the rest of the request inside an AsyncLocalStorage scope
(`als.run(store, next)`; verified: in a linear runner `enterWith` reaches the handler only before
the middleware's first `await`). Tracing spans for handlers can be done by the framework itself
(wrap the handler call in the runner), so it is not a reason to buy the onion.

Guard rails for C2: only a branded `HttpResponse` stops or replaces; `onResponse` registered after
the response is decided throws; a throwing hook is replaced by the registry response (with
`ctx.error`) and the remaining hooks still run; hooks are skipped with a one-time warning for 5.x
handlers that write `res` themselves (`onFinish` still runs); staging after headers are sent is a
clear framework error; an aborted client stops the chain and `onFinish` gets `aborted: true`.
Hooks receive `(response, ctx)` so a middleware without locals can register a shared method
(no allocation). Naming: Fastify's `onResponse` runs _after_ sending — `beforeSend` would avoid
that ambiguity.

## OpenTelemetry with the stages model (experiment, 2026-11-01)

Real packages (`@opentelemetry/api` 1.9, `sdk-trace-node`/`sdk-trace-base` 2.12.0,
`instrumentation-http` 0.223.0 — the newest `instrumentation-http` 0.300.0 needs API 1.10 while
SDK 2.12 accepts only < 1.10, so a matching set had to be chosen), a stages (C2) runner on plain
Node `http`, spans exported in memory. Span trees per scenario:

```
stages, no tracing code            stages, middleware span for its own work
- POST /orders [http.route]        - POST /orders [http.route]
  - db find user                     - auth check
  - db insert order                    - db find user
                                     - db insert order

stages, middleware wants the       stages, runner adds framework spans
handler under its span             - POST /orders [http.route]
- POST /orders [http.route]          - middleware auth
  - db insert order   ← sibling        - db find user
  - transaction                      - middleware timing
                                     - handler POST /orders
                                       - db insert order

stages + opt-in ctx.scope(wrap)    onion (context.with around next)
- POST /orders [http.route]        - POST /orders
  - transaction                      - transaction
    - db insert order                  - db insert order
```

- The server span (http instrumentation) is active through the whole stages runner; every
  instrumented call (DB, Redis, outgoing HTTP) nests under it with no code in middleware.
- The runner knows the route template and sets `http.route` and the span name on the server span.
- A middleware span for its own work nests its own calls.
- The one gap: a stages middleware cannot make its span the parent of the handler's work (it
  ends up a sibling). Two fixes, both verified: framework-owned spans around each middleware and
  the handler (the runner wraps the calls in `context.with`), or an opt-in
  `ctx.scope((run) => context.with(…, run))` that the runner applies around the handler — only
  requests whose middleware asked for it pay for the wrapping.

Experiment source: session scratchpad (outside the repository).

## Node's built-in tracing hooks: `diagnostics_channel` (experiment, 2026-11-01)

`node:diagnostics_channel` lets a library publish named events; anyone can subscribe. Publishing
with no subscriber is close to free. `tracingChannel(name)` publishes `start`, `end`,
`asyncStart`, `asyncEnd` and `error` around a call (`tracePromise(fn, message)`), and
`channel.start.bindStore(asyncLocalStorage, …)` lets the **subscriber** make a value — an
OpenTelemetry span — active for the traced call. So the framework stays OTel-free and an OTel
integration still gets spans that parent the handler's work.

Measured on Node 26.12.1 with real OTel (`exp-dc.cjs`, session scratchpad):

- Built-in channels that fired for one request, in order: `net.server.socket`,
  `http.server.response.created`, `http.server.request.start`, `http.server.response.finish`.
  Node has no `TracingChannel` for the HTTP server (`tracing:http.server.request:*` never fired);
  it gives start/finish points, not spans.
- A stages runner wrapping only the handler in `tracingChannel('adaptivestone:handler')`, plus a
  subscriber that starts a span in `start.bindStore(...)` and ends it on `asyncEnd`:

  ```
  - POST /orders
    - db find user          ← middleware work, under the server span
    - handler POST /orders  ← created by the subscriber, not by the framework
      - db insert order     ← handler work nests under it
  ```

- Cost per call: plain await 49 ns; `tracePromise` with no subscriber 66 ns; with a subscriber
  263 ns. No subscriber, no allocation beyond the message object.
- Caveat: the OTel API does not expose its `AsyncLocalStorage`; the experiment used the context
  manager's internal field. A real integration ships its own subscriber package.

Who already publishes channels (sources read in the session clones):

| Library                                                   | Channels                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Express `router` 2.2.0 (installed here via Express 5.3.0) | `express.router.request` per layer                                                                               |
| Fastify                                                   | `fastify.initialization`, `fastify.request.handler` (tracing)                                                    |
| AdonisJS http-server                                      | `adonisjs.http.request`, `.middleware`, `.route.handler`, `.exception.handler`, `.response.serializer` (tracing) |
| h3 v2                                                     | `h3.request` (tracing plugin, middleware and routes)                                                             |
| undici / `fetch`                                          | `undici:request:*`; the official `@opentelemetry/instrumentation-undici` 0.34.0 is built on them                 |

For us: our middleware and handlers run inside one Express layer (the routing adapter), so
`express.router.request` sees that one layer, not our middleware or handlers. The framework should
publish its own tracing channels (request, each middleware, handler, error resolution, response
write), the way AdonisJS does. That closes the stages gap above without `ctx.scope`, costs ~17 ns
per traced call when nobody listens, and gives OTel, APM agents and tests one hook. Belongs to the
`diagnostics_channel` namespace in [observability](../later/observability.md).

## AsyncLocalStorage from middleware (experiment, 2026-11-01)

Question: a middleware finds the user (or anything per request) and later code that never receives
`req`/`ctx` — services, models, loggers — reads it from `AsyncLocalStorage`. Does it work?

**Today's framework (real `ExpressAdapter`, Node 26.12.1 and Bun 1.4.4, identical results):**

| Inside a framework middleware                                           | Handler sees the user? |
| ----------------------------------------------------------------------- | ---------------------- |
| `als.run(store, () => next())` (the usual Express recipe)               | no                     |
| `als.enterWith(store)` before the first `await`, then `next()`          | yes                    |
| `als.enterWith(store)` after an `await`, then `next()`                  | no                     |
| Express middleware mounted before the framework, `als.run(store, next)` | yes                    |

The adapter awaits a promise that `next()` resolves, so the rest of the chain continues in the
adapter's context, not inside the middleware's `run`. The usual recipe silently does nothing.

**Stages runner (C2), 40 concurrent requests per scenario, both runtimes identical** (count = the
request saw its own user, never another request's):

| Option                                                                                                                                         | handler | services | onResponse | onFinish |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | ---------- | -------- |
| A. framework store: runner runs each request in `store.run(ctx)`; middleware sets `ctx.state.user`; anyone reads `requestContext().state.user` | 40      | 40       | 40         | 40       |
| B. `ctx.runInside((next) => myStore.run(value, next))`; runner wraps the handler                                                               | 40      | 40       | 0          | 0        |
| C. library binds its own store to the framework's handler tracing channel (`start.bindStore`, set up once)                                     | 40      | 40       | 0          | 0        |
| D. `enterWith` before the first `await` (value must be known synchronously)                                                                    | 40      | 40       | 40         | 40       |
| D. `enterWith` after an `await` (the usual case: user comes from the DB)                                                                       | 0       | 0        | 0          | 0        |
| E. `als.run(value, …)` inside a stages middleware (nothing to wrap)                                                                            | 0       | 0        | 0          | 0        |

B and C cover the handler only; the runner could also wrap `onResponse`/`onFinish` if needed.

**Cost of A** (one `run` per request; noisy, two Node runs + one Bun run): +140 to +380 ns per
request; +70 to +180 B retained per in-flight request (the `ctx` itself is held anyway).

**What the market does** (sources read):

- One framework-owned store holding the request context, filled by middleware, read anywhere:
  Koa (`new Koa({ asyncLocalStorage: true })` → `app.currentContext`, off by default), AdonisJS
  (`useAsyncLocalStorage`, default `false` → `HttpContext.getOrFail()`), SvelteKit
  (`getRequestEvent()`, always on), Hono (`contextStorage()` middleware → `getContext()`), Fastify
  (`@fastify/request-context` 7.0.5: `als.run` once in `onRequest`, re-entered at `preValidation`;
  later hooks `set`/`get` values in it).
- Middleware-owned stores by wrapping `next`: Koa, Hono, Express (synchronous `next`).

Conclusion: a stages middleware cannot wrap the rest of the request, so the "provide my own store"
case needs a runner hook (B) or a channel (C). The common case — user, request, ids — is A, which
every surveyed framework offers in some form.

Experiment sources: session scratchpad `als/` (outside the repository).
