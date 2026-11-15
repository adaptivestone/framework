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
