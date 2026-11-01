# P1m — Async/await middleware contract (breaking)

**Status**: ⏸ queued — RE-SCOPED 2026-08-31 (user-approved): **v5.6 opt-in bridge via `static contractVersion = 2`, v6 flips the default and drops v1.** (Retargeted 5.5 → 5.6 on 2026-10-03 together with P1q.) Linear direction (Option A) settled by
[P1q universal HTTP responses](../active/universal-http-responses.md); co-designed and landed WITH P1q in v5.6.
**Depends on**: P1b ✅ (tree router / `ExpressAdapter`) and P1q (v5.6) response bridge — the v2 contract's
returned `HttpResponse` rides P1q's writer, so the two ship in the same minor. The v6 half (default flip,
v1 removal, built-in migration) still lands alongside [static-middleware-cutover](../later/static-middleware-cutover.md) —
both touch `AbstractMiddleware` + the adapter, so one breaking-doc migration note for users.

## v5.6 opt-in bridge (approved 2026-08-31 for v5.5; retargeted 2026-10-03)

- `AbstractMiddleware` gets `static get contractVersion(): 1 | 2` defaulting to `1` — the house
  static-getter pattern (`usedAuthParameters`), readable by adapter and codegen with zero instantiation.
- `ExpressAdapter.runMiddleware` dispatches per class contract: **v2** → `await instance.middleware(ctx)`;
  `void` return → continue, returned `HttpResponse` → P1q writer + stop, `throw` → error-handler registry
  (upgrading middleware errors, which today bypass the registry into the 500 sink); response already sent
  (`headersSent`) → stop. **v1** → the existing Promise bridge, untouched.
- **Framework built-ins stay v1 through all of v5.** Flipping a built-in's `middleware(req, res, next)`
  signature would break every consumer subclass overriding it (contractVersion is inherited statically while
  the override keeps the old arity → `next` is undefined at runtime). Built-ins migrate in v6 with the flip.
  Dogfood candidates before that, if desired: app-level internals nobody subclasses (`PrepareAppInfo`, `IpDetector`).
- v5.6 docs mark v1 deprecated with the mechanical migration table below; consumers migrate class-by-class
  at their own pace across v5.6 → v6 instead of a big-bang rewrite.
- v6: default flips to 2, v1 dispatch + the Promise bridge are deleted, built-ins migrate, `contractVersion`
  itself becomes vestigial (kept one major as a no-op or dropped — decide at cutover).
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

**Key observation:** the current model is already _linear_, not onion. `next()` only resolves the bridge promise so the loop advances — a middleware **cannot** run code after the downstream handler completes (anything after `next()` runs detached, before the handler). So removing `next` in favor of return-to-continue is **semantics-preserving**, while a Koa-style awaitable `next()` would be a _new_ capability, not a preservation.

## D1 — settled direction

| Option                                               | Contract                                                     | Continue / error / stop                                        | Notes                                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — Linear, no `res`/`next` (chosen)**             | `async middleware(ctx): Promise<void \| HttpResponse>`       | `void` → continue · response → stop · `throw` → error registry | Faithful to today's linear ordering and P1q's portable response boundary. The Promise bridge and response-event bookkeeping disappear from registry middleware dispatch. |
| **B — Awaitable `next()` (rejected until demanded)** | `async middleware(ctx, next): Promise<void \| HttpResponse>` | `await next()` runs downstream then returns control            | New onion capability (post-handler timing/cleanup) with continuation machinery nobody currently needs.                                                                   |

**Option A is settled.** It matches current linear ordering, removes both Express parameters, and
uses the returned-response path already exercised in v5.3. Reopen B only with a concrete
wrap-around middleware use case.

> **Reopen flag (2026-11-01):** concrete wrap-around cases now exist — a middleware's own
> AsyncLocalStorage store, a DB transaction rolled back on a handler throw, a span that parents the
> handler's work. D1 is reopened together with D2.1; see
> [middleware-design-proposals](../reference/middleware-design-proposals.md). Not decided yet.

> **Further review (2026-11-01):** the owner now permits explicit `return next()` in simple
> middleware. [Astro Proposal](../reference/astro-proposal.md) compares a strict explicit-next
> onion candidate with H, includes the independent Sol review, and connects the decision to future
> native capabilities. The earlier no-`next` constraint is relaxed for that proposal; D2.1 is still
> open. Publication of research is not approval to change the runtime contract.

> **Decision (2026-11-01):** D1 is superseded. The owner chose a **strict explicit-next onion**:
> `middleware(ctx, next)`; `return next()` continues, a returned `HttpResponse` stops, a throw
> travels up through every middleware and is resolved by the registry once. Production guards and
> development diagnostics; contract and rules in
> [middleware-final-recommendation](../reference/middleware-final-recommendation.md).

> **Priority clarification (2026-11-01):** this change completes the portable response/middleware
> contract needed to remove Express. Rust validation and paired native middleware are future
> compatibility considerations, not implementation prerequisites. The
> [Astro scope review](../reference/astro-proposal.md#smallest-useful-deliverable-now) identifies the
> shared pipeline boundary, remaining listener/global/type coupling and the adapter cutover.

> **Review handoff (2026-11-01):** the owner requested recording the
> [Auth/ALS/completion examples](../reference/astro-proposal.md#api-comparison-for-review-auth-als-and-completion-logging)
> for Opus review. Strict onion is the author's recommendation; H remains the documented alternative.
> D2.1 is pending review and the owner's final decision; no runtime implementation is authorized.

## D2 — what `ctx` is (direction C chosen 2026-10-31; final shape after market research)

**User decision 2026-10-31:** option **c** is the priority, but the exact `RequestContext` must
come from a survey of how the market does it (Hono, h3/Nitro, Elysia, Koa, Fastify, Express 5,
NestJS, AdonisJS, Cloudflare Workers, SvelteKit, Astro, Next.js, React Router, Fresh, Encore, …):
it should feel like a proper framework request/response context with the abilities those offer,
not a minimal shim. Proposal goes back to the user before implementation.

The plan says `middleware(ctx)` but never defines `ctx` for the v5 opt-in. It matters because the
point of opting in during 5.x is that a v2 middleware survives v6 (and later the Node adapter)
unchanged. With P1q Phases 0–2 done, this is the only thing blocking implementation.

| Option              | `ctx` at runtime                                                                                                   | `ctx` type                                                                          | Survives v6 / Node adapter?                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| a                   | the request handlers get (`FrameworkRequest`, Express `Request` underneath)                                        | `FrameworkRequest`                                                                  | v6 yes; Node adapter no — any Express request API used (`ctx.get()`, `ctx.cookies`, …) breaks there                                                   |
| b                   | a new framework object (`method`, `path`, `headers`, `params`, `query`, `body`, `appInfo`, `ip`) built per request | new `RequestContext`                                                                | yes, but adds an allocation per request and a second object beside the `req` handlers still get in v5                                                 |
| **c (recommended)** | the same request object as (a)                                                                                     | a framework-owned `RequestContext` interface listing only the portable fields above | yes: code that compiles against the interface keeps working when the runtime object changes; `appInfo` written by middleware is the one handlers read |

Recommendation: **c** — no new runtime object, no per-request cost, and the type is the
portability contract. The exact field list of `RequestContext` is part of the decision.

### Proposal after the market survey (2026-10-31, awaiting the user)

Survey of 23 frameworks: [request-context-survey](../reference/request-context-survey.md). The
proposal keeps what is already ours (per-route typed `appInfo`, the error registry, returned
`HttpResponse`) and adds what nearly every mature context offers.

```ts
interface RequestContext<AppInfo = BaseAppInfo> {
  // Request: read-only, portable
  readonly method: string;
  readonly path: string; //                    decoded path, no query
  readonly url: URL; //                        lazy; host/protocol per trusted-proxy config
  readonly route: string | undefined; //       matched template, e.g. '/users/:id'
  header(name: string): string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly params: Readonly<Record<string, string>>; // raw; validated → appInfo.params
  readonly query: Readonly<Record<string, unknown>>; //  raw; validated → appInfo.query
  readonly body: unknown; //                   parsed body (files included); validated → appInfo.request
  readonly ip: string | undefined; //          IpDetector, trusted-proxy aware
  readonly cookies: { get(name: string): string | undefined }; // D2.5
  // Identity and lifecycle (all lazy: no cost unless used)
  readonly id: string; //                      X-Request-Id or generated
  readonly logger: Logger; //                  child logger tagged with `id`
  readonly signal: AbortSignal; //             aborts when the client disconnects
  onFinish(
    cb: (outcome: {
      status: number;
      aborted: boolean;
      durationMs: number;
    }) => void,
  ): void;
  // Per-request state: unchanged, typed per route by codegen + static `provides`
  appInfo: AppInfo;
  // Response staging: applied to whatever response is sent
  readonly response: {
    setHeader(name: string, value: string): void;
    appendHeader(name: string, value: string): void;
    setCookie(name: string, value: string, options?: CookieOptions): void; // D2.5
    deleteCookie(name: string, options?: CookieOptions): void;
  };
}
```

**Runtime in 5.x — decided 2026-11-01: a separate framework object (option b).** The earlier
choice (c, reuse the Express `req`) fails because five planned names already mean something else on
`req`: `route` (an object `{ path, methods }` set by the adapter), `url` (Node's path + query string),
`path` (Express's raw, not decoded, path), `ip` (Express's guess, which ignores our proxy settings)
and `cookies` (`cookie-parser`'s plain object). A small `RequestContext` class per v2 request reads
from the Node request with lazy getters; `ctx.appInfo` is the same object as `req.appInfo`, so v1 and
v2 middleware share data; `ctx.response.*` writes to the staged headers the writer applies. v1 code
keeps `req` unchanged. Measured cost: **80 B per request** on Node 24, Node 26 and Bun; lazy features
only when used (`url` ≈ 270 B, `onFinish` ≈ 240 B, `signal` ≈ 90 B on Node;
[context-object-cost.mjs](../reference/middleware-experiments/context-object-cost.mjs)). In v6 there is
no Express `req` to reuse, so this object is the request context at no extra cost; with the Node
adapter (P3) the same class reads from Node directly.

**Sub-decisions** (one by one with the user; recommendation first):

- **D2.1 Flow** — reopened by the user 2026-10-31 ("request + response middleware is probably
  better"); source study of 14 frameworks + benchmark in
  [middleware-flow-models](../reference/middleware-flow-models.md). Correction: h3 v2 is **hybrid**,
  not linear (its `next()` returns the downstream response). Options:
  - **A — request-only** + response staging + `onFinish`. Simplest; cannot wrap the handler.
  - **B — onion with safe defaults (recommended):** `async middleware(ctx, next)`.
    Return nothing without calling `next` → the chain continues (request-only middleware stay
    one-liners, React Router's auto-`next`); return an `HttpResponse` → stop and answer (only the
    branded value stops, so an accidental return cannot end the request — h3's pitfall);
    `const response = await next()` → the rest of the chain runs and its response comes back,
    return it or a new one. `next()` never throws: errors come back as the error registry's
    response with the original on `ctx.error`, so outer middleware still run for errors.
    Calling `next` and forgetting to return bubbles its result; a second `next()` call throws at
    call time; returning before an un-awaited `next()` settles warns. Plus `onFinish` for
    after-send metrics.
  - **C — separate hooks per middleware:** `onRequest(ctx)` and `onResponse(ctx, response)`
    methods (response hooks in reverse order, for every response including errors). No `next`
    to misuse, but no shared locals or `try/finally` around the handler.
  - **D — h3-style hybrid as is:** any non-`undefined` return stops; optional `next`.
  - **Independent review (Fable, 2026-10-31):** C2 — B over-engineered (≈2.5× retained memory per
    pending request with 2 wrapping layers, ≈5× with all wrapping; five extra runner rules; its
    one unique capability, AsyncLocalStorage wrapping, can live in the framework). Details and
    guard rails: [middleware-flow-models § Independent review](../reference/middleware-flow-models.md#independent-review-fable-2026-10-31).
    Awaiting the owner's decision.
  - **Two more options that cover every requirement (2026-11-01, awaiting the owner):**
    **C2W** = C2 + `ctx.runInside(wrap)`; **H** = hybrid by declaration — a middleware class has
    `run(ctx)` (stage) or `around(ctx, next)` (wraps the rest), composed once at startup
    (NestJS guards vs interceptors, Spring interceptors vs filters). Both ≈ half of B's memory
    for typical apps. See
    [middleware-flow-models § Is onion the only model](../reference/middleware-flow-models.md#is-onion-the-only-model-that-covers-everything-2026-11-01).
  - **Outside reviews (2026-11-01):** Fable and Sol pick **H** (`middleware(ctx)` or
    `around(ctx, next)`); Astra, after the owner allowed `return next()`, picks a **strict
    explicit-next onion** with H as the alternative. All agree: raw errors unwind wrappers, registry
    once at the top, write after the chain, single-use `next`. Measured gap: H saves ≈ 0.7 KB (Node) /
    0.2–0.3 KB (Bun) per pending request with async ordinary middleware, none otherwise. See
    [middleware-design-proposals §9–10](../reference/middleware-design-proposals.md),
    [middleware-review-fable](../reference/middleware-review-fable.md),
    [astro-proposal](../reference/astro-proposal.md). Awaiting the owner.
  - **Final recommendation (2026-11-01, accepted by the owner):** strict onion (Astra's contract),
    per the owner's priority on the simplest contract; production guards + development
    diagnostics; identical results on Node 24, Node 26 and Bun; H stays the measured alternative
    (≈ 0.6–0.8 KB and 0.3–1.8 µs cheaper per request). See
    [middleware-final-recommendation](../reference/middleware-final-recommendation.md).
  - **OpenTelemetry (experiments, 2026-11-01):** works with C2 — the server span stays active
    through the runner. The one gap (a middleware span cannot parent the handler's work) closes
    with framework-published `diagnostics_channel` tracing channels around middleware and the
    handler (~17 ns per call with no subscriber); no `ctx.scope` needed. See
    [middleware-flow-models § diagnostics_channel](../reference/middleware-flow-models.md#nodes-built-in-tracing-hooks-diagnostics_channel-experiment-2026-11-01).
  - **Decided 2026-11-01: strict onion** — the owner wants the simplest contract for the future;
    the measured memory/CPU difference to H is accepted. v5 bridge: the owner accepts any form
    because v6 removes it; use an explicit "already sent" response kind for legacy direct writes,
    which keeps the v2 `Next` type `Promise<HttpResponse>` unchanged in v6.
- **D2.2 Request representation** — **decided 2026-11-01:** plain portable fields on a separate
  framework object (see "Runtime in 5.x" above), with the names as proposed: `route` = matched
  template string (`undefined` when unmatched), `url` = lazy `URL` (host/protocol per trusted-proxy
  config), `path` = decoded path without query, `ip` = IpDetector's trusted-proxy-aware address,
  `cookies` reserved for D2.5. Original text: plain portable fields as above. Alternative: a Web `Request`
  underneath (`ctx.request`), which costs a conversion per request on Express; can be added later
  as a lazy getter with the Node adapter.
- **D2.3 State** — **decided 2026-11-01: A, keep `ctx.appInfo`** (the same object as `req.appInfo`
  in 5.x), typed per route by codegen; no typed-keys API planned. Codegen already reads `provides`
  from middleware imported from npm packages that ship `.d.ts`, so packages need no other API. Docs
  rule: a package puts its data under its own key (`appInfo.myPackage`) to avoid collisions. The
  name `appInfo` stays; a rename, if wanted, belongs to the post-release cleanup. Original text:
  keep `appInfo`, typed per route by codegen from each middleware's `provides`
  (the market's weak spot is global augmentation that lies on routes without the middleware).
  Alternative: typed keys (`createContext<T>()`, React Router) for reusable middleware packages.
- **D2.4 Staged headers on error responses** — **decided 2026-11-01: yes,** apply to every response, errors included (what
  Express apps rely on today, e.g. CORS). Alternative: h3's rule — drop them on ≥400 except an
  explicit error-headers set.
- **D2.5 Cookies** — **decided 2026-11-01: A, on `ctx`.** `ctx.cookies.get(name)` (lazy parse) and
  `ctx.response.setCookie(name, value, options)` / `deleteCookie(name, options)`, staged like other
  response headers; defaults `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` except on plain
  `http://localhost`; the `cookie` package becomes a direct dependency (today it only arrives
  through Express). Not now: signed/encrypted cookies, sessions. Original text: the framework
  parses no cookies today. Add `ctx.cookies.get` (lazy parse) and
  `ctx.response.setCookie/deleteCookie` with secure defaults (`HttpOnly`, `Secure`,
  `SameSite=Lax`); nearly every surveyed framework has this. Alternative: leave cookies to apps.
- **D2.6 Identity and lifecycle** — `id`, `logger`, `signal`, `onFinish`, all lazy. Not now:
  `waitUntil` (no platform lifetime on Node; `onFinish` covers after-response work).
  - **Ambient access through AsyncLocalStorage — decided 2026-11-01: framework store on by
    default** (`requestContext()`). Background (experiments):
    a stages middleware cannot wrap the rest of the request, so `als.run(store, next)` cannot work
    by design — and it already silently does nothing inside today's framework middleware. Options:
    A, one framework store per request holding `ctx` (`requestContext()`), filled by middleware —
    what Koa, AdonisJS, SvelteKit, Hono and Fastify offer; B, `ctx.runInside(wrap)` for a
    middleware's own store; C, tracing-channel `bindStore` for libraries. See
    [middleware-flow-models § AsyncLocalStorage](../reference/middleware-flow-models.md#asynclocalstorage-from-middleware-experiment-2026-11-01).
- **D2.7 v6 handlers** — receive the same `ctx` (one object for middleware and handlers, the
  market norm); in 5.x handlers keep `req`, which is the same runtime object.

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

| Today                                                                               | After (A)                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `runMiddleware` `new Promise` + `settle` + `res.once('finish'/'close')` bookkeeping | gone — `await instance.middleware(ctx)`                      |
| `next()` / `next(err)` / mutate `res`                                               | `void` / `throw` / return `HttpResponse`                     |
| Express `res` and `next` threaded through every registry middleware                 | absent                                                       |
| Transport completion detected indirectly from Express events                        | explicit returned response; writer owns transport completion |

## Out of scope

- Exact v6 raw-route API — P1q reserves an explicit adapter-specific escape hatch.
- Global Express middleware mounted directly via `app.express.use` (Cors-as-global, security headers, `RequestParser`) — those run on the raw Express stack, not the adapter loop; they keep Express's native `(req,res,next)`. This card is only the **registry-dispatched** middleware contract. (Confirm the framework-middleware list against this split when building.)
- Static metadata getters — that's [static-middleware-cutover](../later/static-middleware-cutover.md); land together but they're orthogonal changes.
- `WeakMap` instance cache keyed by `(Class, params)` — orthogonal request-time dedup, tracked elsewhere.

## Done when

- `AbstractMiddleware.middleware` signature is `(ctx) => Promise<void | HttpResponse>`; neither
  Express `res` nor `next` is exposed.
- `ExpressAdapter.runMiddleware` Promise bridge and middleware-owned response-event listeners are
  removed; returned responses use `ResponseWriter`, and thrown errors use the registry.
- All framework-own registry middlewares migrated; full suite + `gen --check` green.
- `03-middleware.md` rewritten with a one-keyword-per-middleware migration block; CHANGELOG `[BREAKING]`.

## Trade-offs

- Breaking for every consumer registry middleware — but v5.3 provides a full release line to
  migrate response-producing code before v6 removes `res`.
- **A** forecloses onion wrap-around (post-handler code) — acceptable since today's model already can't do it; a consumer needing it is the trigger to revisit **B**.
- **B** keeps `next` and adds continuation machinery for a capability nobody currently uses — heavier, speculative. Default to A.
