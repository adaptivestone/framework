# Middleware flow — design proposals (for review)

**Status**: **decided 2026-11-01 — strict onion** (D2.1 in [async-middleware](../done/async-middleware.md);
see [middleware-final-recommendation](middleware-final-recommendation.md)). Written
2026-11-01 to be read on its own by reviewers who have not seen the other plans. Measurements and
source evidence behind every number here: [middleware-flow-models](middleware-flow-models.md).

**What we ask a reviewer:** which option would you pick, is there a better one, what did we miss?
Add your notes at the end (section 10).

## 1. Context

- `@adaptivestone/framework`: a TypeScript backend framework for Node.js (≥ 24) and Bun (≥ 1.4).
  Express 5 runs underneath today; a framework-owned Node HTTP adapter is planned.
- A controller declares routes. Each route has a list of middleware classes and a handler. The
  handler may return an immutable response (`return HttpResponse.json(201, body)`). A thrown error
  goes to an error-handler registry that turns it into a response.
- Per-request data lives in `req.appInfo`, typed per route by code generation.
- A middleware today (5.x):

  ```ts
  class RoleMiddleware extends AbstractMiddleware {
    async middleware(req, res, next) {
      if (!hasRole(req.appInfo.user, this.params.roles)) throw new ForbiddenError(/* … */);
      return next();
    }
  }
  ```

- The framework runs a route's middleware one after another, then the handler. It waits for
  `next()`, then starts the next middleware. **A middleware can only act before the handler.**

## 2. The problem in one picture

```
today:  request ─▶ mw1 ─▶ mw2 ─▶ mw3 ─▶ handler ─▶ response
                   (each one runs, finishes, then the next starts)
```

Middleware have four kinds of jobs:

```
BEFORE       check something, maybe stop          Role, Auth, RateLimit
AFTER        look at / change the response        Server-Timing header, cache headers
AFTER SEND   when the last byte has left          metrics, access log
WRAP         the handler must run INSIDE my code  own AsyncLocalStorage store, DB transaction,
                                                  tracing span that contains the handler's work
```

WRAP is the hard one. The middleware's code must still be running while the handler runs:

```ts
userStore.run(user, () => handler()); //          handler and deep code see `user`
connection.transaction(() => handler()); //       rolled back if the handler throws
```

A middleware that has already returned cannot wrap anything. Today even the usual Express recipe
`als.run(store, () => next())` silently does nothing inside framework middleware (measured, §5).

Only a few middleware need WRAP. Most need only BEFORE. The design question is **who pays for
wrapping**: every middleware (onion) or only the ones that ask.

## 3. Requirements

1. BEFORE-only middleware (like `Role`) stay as simple as today: no `next`, no after-logic.
2. AFTER: add or replace headers, replace the response, measure request → response time.
3. AFTER SEND: run code when the response is fully sent (or the client went away).
4. WRAP with AsyncLocalStorage: deep code that never receives `req`/`ctx` can read the current
   user, the request, a tenant or a transaction session — from a framework store **and** from a
   middleware's own store.
5. Tracing (OpenTelemetry): a middleware's span can be the parent of the handler's work.
6. `try/catch/finally` around the rest: commit a transaction on success, roll back when the
   handler throws.
7. Low memory per in-flight request (long streams, many concurrent requests); few runner rules; no
   over-engineering.
8. Errors still go through the error-handler registry; handlers keep returning `HttpResponse`.

Compatibility: 5.x middleware classes keep working through a bridge; the new contract is opt-in in
5.x (`static contractVersion = 2`) and the default in v6.

## 4. The four test middleware

Every option below is shown with the same four middleware:

- **M1 Role** — stop with 403 unless the user has a role.
- **M2 Timing** — add `Server-Timing: app;dur=…` to the response and log the duration after send.
- **M3 Current user** — load the user once; deep code reads it from AsyncLocalStorage.
- **M4 Transaction** — run the handler in a DB transaction; commit on success, roll back on throw.

Helpers used in the sketches: `isAllowed(ctx)`, `User.findByToken(token)`,
`userStore = new AsyncLocalStorage()`, `connection.transaction(fn)` (commits when `fn` resolves,
aborts when it throws; read it as "a single-execution transaction scope" — Mongoose's real
`connection.transaction` may retry its callback, so it is not safe around `next()`, see Sol in §10), `ctx.response.setHeader(…)` (headers staged on the
response before it is written), `ctx.onFinish(cb)` (after send). Names are not final.

## 5. Measured facts (Node 26.12.1; Bun 1.4.4 where stated)

- **AsyncLocalStorage today**, real framework code, identical on Node and Bun:
  `als.run(store, () => next())` inside a framework middleware → handler sees nothing;
  `als.enterWith` → works only before the middleware's first `await`; an Express middleware mounted
  before the framework router → works.
- **A framework-owned store** (the runner runs every request inside one `store.run(ctx)`; middleware
  write into `ctx`; deep code calls `requestContext()`) works everywhere — handler, services, after
  hooks, after send — under 40 concurrent requests, Node and Bun. Cost: +0.15–0.4 µs and
  +70–180 B per in-flight request.
- **Retained heap per in-flight request**, 10 middleware of which 2 (or 10) wrap/act after:

  | wrapping middleware       | request-only | C2      | C2W     | H             | D       | Onion (B) |
  | ------------------------- | ------------ | ------- | ------- | ------------- | ------- | --------- |
  | 2 of 10, timing           | ≈ 0–290 B    | 1 343 B | 1 423 B | 1 864 B       | 2 696 B | 3 403 B   |
  | 2 of 10, own async store  | —            | —       | 1 792 B | 1 224–1 559 B | 2 592 B | 3 184 B   |
  | 10 of 10, timing          | —            | 2 129 B | 2 207 B | 6 880 B       | —       | 10 720 B  |
  | 10 of 10, own async store | —            | —       | 2 449 B | 4 228 B       | —       | 8 963 B   |

  For scale: a pending request on plain Node `http` holds ≈ 4.7 KB, with Express ≈ 6.3 KB.
  **Limit (Astra, 2026-11-01):** the harness suspends requests _inside the handler_ (slow DB,
  long poll). It does not measure an active streaming response: the handler returns a stream
  descriptor, the middleware chain unwinds, and only then does writing start — so no model keeps
  middleware frames during a long stream. Streaming is still to be measured separately.
- **Tracing**: OpenTelemetry's request span stays active through any runner; database and HTTP
  client spans nest under it with no middleware code. Only "my span contains the handler's work"
  needs WRAP — or framework-published `node:diagnostics_channel` tracing channels around each
  middleware and the handler (+17 ns per call when nobody listens), which let an OTel subscriber
  make its span active for the handler.

## 6. Options

### A — Request-only (+ `onFinish`)

Middleware run before the handler and return. Nothing after, except after-send callbacks.

```
request ─▶ M1 ─▶ M2 ─▶ M3 ─▶ handler ─▶ write ─▶ (after send: onFinish callbacks)
```

```ts
class Role {
  async run(ctx) {
    if (!isAllowed(ctx)) return HttpResponse.json(403, { error: 'FORBIDDEN' });
  }
}
class Timing {
  async run(ctx) {
    const t0 = performance.now();
    ctx.onFinish(() => log(performance.now() - t0));
  }
}
// Server-Timing header: impossible — the duration is not known before the handler.
class CurrentUser {
  async run(ctx) {
    ctx.state.user = await User.findByToken(token(ctx));
  }
}
// deep code: requestContext().state.user — framework store only, no own store.
// Transaction: impossible.
```

Meets 1, 3, 7, 8. Misses 2, 4 (own store), 5 (without channels), 6. Smallest and simplest.

### B — Onion (Koa, Hono, Express 5 `router`)

Every middleware gets `next`. `await next()` runs the rest of the chain and the handler and gives
back the response. Code after `await next()` is the AFTER part. A middleware that returns without
calling `next` continues automatically ("safe defaults"), so `Role` stays a one-liner.

```
request ─▶ M2 before ─▶ M3 before ─▶ M4 before ─▶ handler
                                                  │
response ◀─ M2 after ◀── M3 after ◀── M4 after ◀──┘   (each layer waits for the inner ones)
```

```ts
class Role {
  async run(ctx) {
    if (!isAllowed(ctx)) return HttpResponse.json(403, { error: 'FORBIDDEN' });
  }
}
class Timing {
  async run(ctx, next) {
    const t0 = performance.now();
    const res = await next();
    ctx.response.setHeader(
      'server-timing',
      `app;dur=${performance.now() - t0}`,
    );
    ctx.onFinish(() => log(performance.now() - t0));
    return res;
  }
}
class CurrentUser {
  async run(ctx, next) {
    return userStore.run(await User.findByToken(token(ctx)), next);
  }
}
class Transaction {
  async run(ctx, next) {
    return connection.transaction(() => next());
  }
}
```

Meets 1–8. Costs the most memory while the handler is pending: every layer keeps a waiting async
frame, a promise and a `next` closure (not during streaming — see the limit in §5). Needs rules: forgot `await`/`return` on
`next()`, `next()` called twice, does `next()` throw or return the error response.

### C1 — Two methods per middleware: `onRequest` / `onResponse`

```
request ─▶ M1.onRequest ─▶ M2.onRequest ─▶ handler ─▶ M2.onResponse ─▶ M1.onResponse ─▶ write
```

```ts
class Role {
  async onRequest(ctx) {
    if (!isAllowed(ctx)) return HttpResponse.json(403, { error: 'FORBIDDEN' });
  }
}
class Timing {
  async onRequest(ctx) {
    ctx.state.t0 = performance.now();
  } // per-request data must live on ctx
  async onResponse(ctx, res) {
    ctx.response.setHeader(
      'server-timing',
      `app;dur=${performance.now() - ctx.state.t0}`,
    );
    return res;
  }
}
class CurrentUser {
  async onRequest(ctx) {
    ctx.state.user = await User.findByToken(token(ctx));
  }
} // framework store only
// Transaction: start in onRequest, commit/abort in onResponse by status — but the handler's DB
// calls do not join the session automatically (no wrap); the session must be passed by hand.
```

Meets 1, 2, 3, 7, 8. Misses 4 (own store), 5, 6 (partly). Per-request data goes through `ctx`.

### C2 — Stages with callbacks (`ctx.onResponse`, `ctx.onFinish`)

Like A, but a middleware can register "call me with the response" callbacks while it runs. They
run newest first, before the write, for every response including errors and early stops.

```
request ─▶ M1 ─▶ M2 (registers onResponse) ─▶ handler ─▶ M2's callback ─▶ write ─▶ onFinish
```

```ts
class Role {
  async run(ctx) {
    if (!isAllowed(ctx)) return HttpResponse.json(403, { error: 'FORBIDDEN' });
  }
}
class Timing {
  async run(ctx) {
    const t0 = performance.now();
    ctx.onResponse((res) => {
      ctx.response.setHeader(
        'server-timing',
        `app;dur=${performance.now() - t0}`,
      );
      return res;
    });
    ctx.onFinish(() => log(performance.now() - t0));
  }
}
class CurrentUser {
  async run(ctx) {
    ctx.state.user = await User.findByToken(token(ctx));
  }
} // framework store only
// Transaction: same limit as C1.
```

Meets 1, 2, 3, 7, 8; 5 with tracing channels. Misses 4 (own store) and 6. Low memory.

### C2W — C2 plus `ctx.runInside(wrap)`

C2, and a middleware may ask the runner to run later code inside a wrapper.

```
request ─▶ M1 ─▶ M3 (registers wrapper) ─▶ [ wrapper( handler ─▶ callbacks ) ] ─▶ write
```

```ts
class CurrentUser {
  async run(ctx) {
    const user = await User.findByToken(token(ctx));
    ctx.runInside((next) => userStore.run(user, next));
  }
}
class Transaction {
  async run(ctx) {
    ctx.runInside((next) => connection.transaction(() => next()));
  }
}
// Role, Timing: as in C2.
```

**As measured, the wrapper starts at the handler** (Astra, 2026-11-01): with
`Tenant → Auth → handler`, Auth runs before the wrapper and cannot see the tenant store. Wrapping
the later middleware too needs continuation machinery much like H's, with the scope entry less
visible at the call site.

Meets 1–3, 5–8; 4 and 6 for the handler only. Low memory; only requests whose middleware call `runInside` pay. Wrapping through a
registered callback is unusual (no surveyed framework does exactly this) and `try/finally` is
written inside the callback. Rule: errors must pass through wrappers (so a transaction rolls back)
before the registry turns them into a response.

### D — h3 v2 hybrid, as is

Like onion, but `next` is optional, and **any** non-`undefined` return value stops the chain and
becomes the response.

Meets 1–8. Same code as B. Pitfall: a middleware that accidentally returns a value (e.g. the result
of a helper) ends the request. Memory between C2 and B.

### H — Hybrid by declaration: `run(ctx)` **or** `around(ctx, next)`

Each middleware class says what it is. `run` = BEFORE-only (A/C2 style). `around` = wraps the rest
(onion style). The chain is built once at startup: `run` middleware go through a plain loop; only
`around` middleware pay the onion cost.

```
request ─▶ M1 run ─▶ M3 around ┐
                     ┌─────────┘
                     └▶ M4 around ┐
                        ┌─────────┘
                        └▶ handler ─▶ back through M4, M3 ─▶ write ─▶ onFinish
```

```ts
class Role {
  async run(ctx) {
    if (!isAllowed(ctx)) return HttpResponse.json(403, { error: 'FORBIDDEN' });
  }
}
class Timing {
  async around(ctx, next) {
    const t0 = performance.now();
    const res = await next();
    ctx.response.setHeader(
      'server-timing',
      `app;dur=${performance.now() - t0}`,
    );
    ctx.onFinish(() => log(performance.now() - t0));
    return res;
  }
}
class CurrentUser {
  async around(ctx, next) {
    return userStore.run(await User.findByToken(token(ctx)), next);
  }
}
class Transaction {
  async around(ctx, next) {
    return connection.transaction(() => next());
  }
}
```

Meets 1–8. Memory close to C2 when few middleware wrap; grows like onion when many do. Two kinds of
middleware to document; `next` rules apply to `around` only. Precedent: NestJS guards
(`canActivate`) vs interceptors (`intercept(context, next)`); Spring `HandlerInterceptor`
(`preHandle`/`postHandle`/`afterCompletion`) vs servlet filters (`chain.doFilter`); ASP.NET Core
`IActionFilter` vs `IAsyncActionFilter`.

### Add-ons that combine with any option

- **Framework-owned request store** (`requestContext()`), opt-in like Koa (`asyncLocalStorage:
  true`) and AdonisJS (`useAsyncLocalStorage`), or always on like SvelteKit (`getRequestEvent()`).
  Covers "current user / request in async storage" without WRAP.
- **Tracing channels** (`node:diagnostics_channel`) around the request, each middleware, the
  handler, error resolution and the response write — as AdonisJS does. Covers requirement 5
  without WRAP.

## 7. Comparison

| Option | 1 BEFORE simple | 2 AFTER | 3 AFTER SEND | 4 own async store | 5 span parents handler | 6 try/finally | 7 memory (2 of 10 wrap) |
| ------ | --------------- | ------- | ------------ | ----------------- | ---------------------- | ------------- | ----------------------- |
| A      | ✅              | ❌      | ✅           | ❌                | channels               | ❌            | ≈ 0–290 B               |
| B      | ✅              | ✅      | ✅           | ✅                | ✅                     | ✅            | 3.2–3.4 KB              |
| C1     | ✅              | ✅      | ✅           | ❌                | channels               | partly        | ≈ 1 KB                  |
| C2     | ✅              | ✅      | ✅           | ❌                | channels               | ❌            | 1.3 KB                  |
| C2W    | ✅              | ✅      | ✅           | handler only      | handler only           | handler only  | 1.4–1.8 KB              |
| D      | ✅              | ✅      | ✅           | ✅                | ✅                     | ✅            | 2.6–2.7 KB              |
| H      | ✅              | ✅      | ✅           | ✅                | ✅                     | ✅            | 1.2–1.9 KB              |

## 8. Open questions

- In a wrapping design, does `next()` throw the handler's error (needed for a transaction to roll
  back) or return the error response (outer middleware always get a response)?
- Keep `ctx.onResponse` callbacks next to `around`, or one way per job (`around` for AFTER,
  `onFinish` for AFTER SEND)?
- Framework store: opt-in or always on?
- Streaming responses: should AFTER code run when the stream starts or when it ends?
- 5.x bridge: how old `middleware(req, res, next)` classes run inside the new runner.
- Error boundary (Astra): today the controller wrapper catches handler errors itself
  (`src/controllers/index.ts`, `answerError`). For `try { await next(); commit() } catch {
  rollback() }` to roll back, errors must travel up through `around`, and only uncaught errors
  reach the registry. Order to settle: handler → `around` unwinds → registry → `beforeSend` hooks →
  `transformResponse` (P1q Server option) → write → `onFinish`.
- `next` misuse (Astra, reproduced against the onion sketch): `next(); return HttpResponse.empty(202)`
  answers while the handler is still running; throwing after an un-awaited `next()` has the same
  problem; a saved `next` called later can run the handler a second time. Require explicit `next`
  in `around`, reject duplicate and late calls, and keep started downstream work accounted for.
- Resource lifetime (Astra): an `around` transaction ends when the handler returns its response
  descriptor, but a lazy stream may read a DB cursor later. Define that boundary, cleanup when a
  hook replaces a stream, and abort handling.
- `onFinish` means the server finished (Node's `finish`: the last bytes were handed to the OS), not
  that the client received them; also define the async context its callbacks run in.
- D1 in [async-middleware](../done/async-middleware.md) settled the linear contract "until a
  concrete wrap-around use case". Requirements 4–6 are such cases; D1 must be reopened explicitly.

## 9. Ideas from the independent review (Fable)

Full review: [middleware-review-fable](middleware-review-fable.md) (2026-11-01, written without
reading this file or Astra's notes; scripts in
[middleware-experiments/fable](middleware-experiments/fable/)). Summary:

**Pick: H** (Fable calls it G) — `middleware(ctx)` or `around(ctx, next)`, composed once per route
at startup, plus a framework-owned AsyncLocalStorage store (`requestContext()`) and
`ctx.onFinish`. No `ctx.onResponse` / `beforeSend`: `around` covers "before the write", `onFinish`
covers "after the bytes".

Ideas covered, each with the four test middleware, cost and source evidence: request-only, onion
(also a flat-loop variant), `onRequest`/`onResponse` methods, stages + callbacks, stages +
`runInside`, h3 hybrid, H. Also considered: framework store (companion, recommended), tracing
channels (companion, for framework spans only), NestJS's four kinds (more to learn, nothing new),
Fastify-style app-level hooks (later, as sugar over a global `around`), writing the response inside
the chain (rejected, see below), wrapping the handler itself (`withTransaction(handler)`, a user
pattern, not the model), an Express middleware mounted before the router (a working 5.x stopgap).

New measurements (Node 26 / Bun 1.4):

- Pending in the handler, 10 middleware: no wrapping — H ≈ 0, C2 ≈ 0.9 KB (C2 must keep its runner
  frame to run hooks afterwards; one suspended async frame ≈ 0.9 KB); 2 wrapping — H 1.9 KB
  (own store 1.0–1.3 KB), onion 3.4 KB.
- **Streaming: the same ≈ 2.1 KB per in-flight stream in every model** when the response is
  written after the chain unwinds (our writer does this). Writing inside the chain would add
  ≈ 1.7 KB (onion) / 0.9 KB (H) per wrapping layer for the whole stream — rejected.
- C2W's `runInside` store does not reach later middleware; H's `around` store does.
- With "`next()` never throws", a `try/catch` transaction silently commits on a handler error.
- Dispatch CPU: H ≈ 1.4 µs per request for 10 middleware vs ≈ 4.7 µs for today's 5.x bridge; any
  new runner is 3–5× faster than today.

Rules Fable proposes for H:

1. `next()` resolves to the response of the rest of the chain and **rejects with the original
   error** (Koa); one call only (second call throws); an `around` that never calls `next` and
   returns nothing continues the chain; a forgotten `return` still answers (forgiving, +0.3 KB) —
   or strict (the maintainer's choice).
2. Errors are resolved by the registry **once, at the top**, after every `around` has unwound.
3. Order: chain unwinds → registry → `transformResponse` → staged headers (errors included) → write
   → `onFinish` (after `finish`/`close`, with `{ status, aborted, durationMs }`).
4. A resource held by an `around` (transaction) is not alive while a lazy stream body is read —
   a documentation rule, no runtime warning.
5. Client abort: `ctx.signal`; the runner checks it between layers, `onFinish` gets `aborted: true`.
6. 5.x: old `middleware(req, res, next)` classes run through today's bridge as stages; v2 detected
   by `static contractVersion = 2` or by method name (open question).

**Across the three reviews (2026-11-01).** Fable and Sol pick **H**. Astra first picked H, then —
after the owner allowed `return next()` in simple middleware — switched to a **strict
explicit-next onion** (one contract, `return next()` everywhere, no auto-continue), keeping H as
the serious alternative ([Astro Proposal](astro-proposal.md)). Fable's review was written under
the old "no `next` in simple middleware" requirement and did not measure a strict onion.

All three agree: raw errors unwind wrappers before the registry; one error resolution at the top;
the response is written after the chain unwinds (so streaming memory is the same in every model);
`next()` is single-use; a transaction must not outlive its `around`/wrapper while a lazy stream is
read; `onFinish` means the server finished, not that the client received it; a framework-owned
request store works with any model.

They differ on: strict onion vs H (the main question); a per-request `beforeSend` hook (Astra and
Sol yes, Fable no); forgiving `around` (Fable: auto-continue, auto-bubble) vs strict continuation
(Astra, Sol); framework store on by default (Fable).

Strict onion vs H, pending in the handler, 8 ordinary steps + 2 ALS wrappers + 2 hooks
([strict-comparison](middleware-experiments/strict-comparison.mjs); macOS run by Astra, Linux
re-run identical on Node; Bun re-run 2026-11-01):

| Workload                                      | Node strict onion | Node H  | Bun strict onion | Bun H   |
| --------------------------------------------- | ----------------- | ------- | ---------------- | ------- |
| sync steps, wrappers `return store.run(…)`    | 2 226 B           | 2 225 B | 1 170 B          | 1 170 B |
| async steps, same wrappers                    | 3 361 B           | 2 602 B | 1 427 B          | 1 234 B |
| sync steps, wrappers `await next()` + finally | 3 819 B           | 3 707 B | 1 906 B          | 1 826 B |
| async steps, wrappers with finally            | 4 770 B           | 4 084 B | 2 115 B          | 1 843 B |

Writer phase (descriptor returned, chain unwound): ≈ 618 B Node / ≈ 226 B Bun in every case. So
H saves ≈ 0.7 KB (Node) / ≈ 0.2–0.3 KB (Bun) per pending request when ordinary middleware do
async work, nothing when they are synchronous, and nothing while streaming. The other difference
is the misuse surface: in strict onion every middleware can call `next()` without `return`; in H
only `around` middleware can.

## 10. Reviewer notes

Add your name, the option you would pick (or a new one), and why.

### Astra (2026-11-01)

**Pick: H** — simple request middleware, explicit `around`, plus response and completion hooks.
Keeps auth/roles/rate limits simple and gives transactions and custom AsyncLocalStorage scopes a
clear place. Keep the existing method name:

| API                    | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `middleware(ctx)`      | Return nothing to continue; return `HttpResponse` to stop |
| `around(ctx, next)`    | Wrap later middleware and the handler                     |
| `ctx.beforeSend(hook)` | Inspect or replace the response before it is written      |
| `ctx.onFinish(hook)`   | Observe completion, failure or disconnect                 |

Fix before settling the contract (details in §8):

1. "`next()` never throws" breaks ordinary transaction rollback; let errors propagate through
   `around`, then resolve uncaught ones through the registry, then run `beforeSend` hooks. This
   moves the error boundary out of the controller wrapper.
2. C2W as measured wraps only the handler, not later middleware (`Tenant → Auth`); making it wrap
   "the rest" rebuilds most of H — a reason to prefer H.
3. The safe-defaults onion runner has real races (`next(); return …`, throw after un-awaited
   `next`, a saved `next` called later). In `around`, require explicit continuation and guard
   duplicate/late calls.
4. The memory numbers cover requests pending in the handler, not active streams; measure both and
   keep the harness with the proposal (done: [middleware-experiments](middleware-experiments/README.md)).
5. Resource lifetime: transaction vs lazy stream, stream replacement cleanup, abort, the context of
   finish hooks; `onFinish` = server-side completion, not client receipt.

Agrees: ordinary timing/header work belongs in hooks so wrapping stays rare; diagnostics channels
for instrumentation, not as the app-facing mechanism for transaction or tenant scope. Reconcile
with D1 (linear settled) and with P1q's `transformResponse` ordering.

_Note:_ Astra read a local checkout where P1q is still `queued/` and the response writer is only
planned. On this branch P1q is `active/` and the writer, returned responses and
`transformResponse` are built (`src/services/http/ExpressResponseWriter.ts`).

### Sol

Independent GPT-6.1 Sol review (2026-11-01): prefers **H**, with explicit stages and explicit
single-use wrappers, plus separate response preparation and transport completion. Its main
argument is releasing ordinary request-stage frames before a pending handler. Strict explicit-next
onion remains a defensible simpler API if representative measurements show little advantage for H.

Additional finding: `connection.transaction(() => next())` is not a generally safe recipe.
Transaction helpers may retry their callback, which conflicts with single-use continuation and
can replay nontransactional side effects. Keep automatic retries inside a deliberately replayable
operation; do not replay arbitrary downstream middleware. Native implementations must preserve
operation ordering, transformed validation values, errors, hooks and tracing, with JS fallback.
See [Astro Proposal](astro-proposal.md) for the full shared analysis and the remaining disagreement.

### Astro (2026-11-01)

**Revised pick: strict explicit-next onion**, subject to the actual guarded-runner comparison with
H. The owner now accepts `return next()` in simple middleware, so requirement 1's prohibition of
`next` is relaxed for this proposal. This is a new candidate, not the B implementation above:
no auto-continuation, implicit bubbling or patch/sentinel return protocol. Errors unwind wrappers
before registry resolution; response preparation and transport completion remain separate.

[Astro Proposal](astro-proposal.md) connects the middleware decision to the existing response
writer, context/telemetry contracts and optional native capabilities. It includes the independent
Sol dissent, the native-validation equivalence constraint, a phased delivery path and the
[strict onion/H experiment](middleware-experiments/strict-comparison.mjs). No runtime decision is
approved by adding this review, and no production middleware code changes here.
