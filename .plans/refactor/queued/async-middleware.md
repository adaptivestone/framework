# P1m — Async/await middleware contract (breaking)

**Status**: ⏸ queued — **contract settled 2026-11-01** (owner), implementation not started.
**Contract:** strict explicit-next onion — `middleware(ctx, next)` returns `next()` or an
`HttpResponse`, throws travel up through every middleware and the registry resolves them once.
Full contract, rules and measurements: [middleware-final-recommendation](../reference/middleware-final-recommendation.md);
decision record: D1 and D2 below.
**Target**: the next minor (5.7) as an opt-in via `static contractVersion = 2`, landing with
[P1q universal HTTP responses](../active/universal-http-responses.md) (its writer renders the
returned responses). v6 flips the default, drops v1, migrates built-ins, together with
[static-middleware-cutover](../later/static-middleware-cutover.md).
**Depends on**: P1b ✅ (tree router / `ExpressAdapter`), P1q Phases 1–2 ✅ (writer, error
descriptors, `transformResponse`).

## Settled contract (2026-11-01)

| Decision                 | Outcome                                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2.1 flow                | Strict onion. `return next()` continues, a returned `HttpResponse` stops, a throw travels up unchanged; the registry resolves it once at the top.                                                                      |
| Guards                   | Production: `next()` once, refused after the response is chosen, started downstream marked handled, started handler awaited, final value must be a response. Development: name the culprit.                            |
| v5 bridge                | A v1 handler/middleware that wrote `res` itself yields an internal "already sent" response kind; `Next` stays `Promise<HttpResponse>` in v5 and v6.                                                                    |
| D2.2 context             | A separate `RequestContext` object per v2 request in 5.x (80 B measured); `ctx.appInfo` is the same object as `req.appInfo`. Names: `route` (template), `url` (`URL`), `path` (decoded), `ip` (IpDetector), `cookies`. |
| D2.3 state               | Keep `ctx.appInfo`, typed per route by codegen from `provides`; packages namespace their data.                                                                                                                         |
| D2.4 staged headers      | `ctx.response.setHeader/appendHeader` apply to every response, errors included.                                                                                                                                        |
| D2.5 cookies             | `ctx.cookies.get`, `ctx.response.setCookie/deleteCookie`, secure defaults; `cookie` becomes a direct dependency.                                                                                                       |
| D2.6 store               | One framework AsyncLocalStorage store per request, on by default (`requestContext()`); `id`, `logger`, `signal`, `onFinish` lazy.                                                                                      |
| D2.7 handlers            | v6 handlers receive the same `ctx` and return an `HttpResponse`; a 5.x controller opts in with `static contractVersion = 2`.                                                                                           |
| Not in the first version | Per-request `beforeSend` hook; signed/encrypted cookies; sessions; typed-keys state API.                                                                                                                               |

Order of one request: pipeline (middleware → validation → handler) → wrappers unwind → registry
once → global `transformResponse` → writer merges staged headers/cookies → `onFinish` exactly once
(`finished | aborted | failed`). All behaviour is identical on Node 24, Node 26 and Bun (checked).

## v5 opt-in bridge (approved 2026-08-31; contract revised 2026-11-01)

- `AbstractMiddleware` (and, per D2.7, controllers) get `static get contractVersion(): 1 | 2`
  defaulting to `1` — the house static-getter pattern, readable by adapter and codegen with zero
  instantiation.
- The adapter composes each route's chain once. **v2** entries run as strict-onion layers with a
  `RequestContext`; **v1** entries run through today's Promise bridge inside the chain, as a layer
  that continues when the old middleware calls `next()` and yields the "already sent" kind when it
  ended `res`.
- **Framework built-ins stay v1 through all of v5.** Flipping a built-in's signature would break
  every consumer subclass overriding it. Built-ins migrate in v6 with the flip.
- v5 docs mark v1 deprecated with a mechanical migration table; consumers migrate class by class.
- v6: default flips to 2, v1 dispatch and the Promise bridge are deleted, built-ins migrate,
  `contractVersion` becomes vestigial (kept one major as a no-op or dropped — decide at cutover).
- **Open implementation question:** TypeScript will not accept a v2 subclass overriding
  `middleware(ctx, next)` on a base that declares the v1 `middleware(req, res, next)` (TS2416), and
  the forgotten-`return` check needs the strict base type. Options: a separate v2 base class (the
  flag becomes implicit), or a base typed by `contractVersion`. Decide when implementation starts.

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
- **D2.7 v6 handlers** — **decided 2026-11-01: B.** v6 handlers receive the same `ctx` as
  middleware and must return an `HttpResponse` (`HttpResponse.empty(204)` for no content); a 5.x
  controller opts in with `static contractVersion = 2`; codegen emits a per-route context type for
  handlers next to today's request types. Original text: receive the same `ctx` (one object for
  middleware and handlers, the market norm); in 5.x handlers keep `req`.

## API change

```ts
// BEFORE (v5.x, v1)
class GetUserByToken extends AbstractMiddleware {
  async middleware(req, res, next) {
    req.appInfo.user = await resolveUser(req);
    return next();
  }
}

// AFTER (v2 opt-in in 5.7, default in v6)
class GetUserByToken extends AbstractMiddleware {
  static get contractVersion() {
    return 2 as const;
  }
  async middleware(ctx, next) {
    ctx.appInfo.user = await resolveUser(ctx);
    return next();
  }
}

class RateLimiter extends AbstractMiddleware {
  static get contractVersion() {
    return 2 as const;
  }
  async middleware(ctx, next) {
    if (await this.exceeded(ctx))
      return HttpResponse.json(429, { message: 'Too many requests' });
    return next();
  }
}

class Users extends AbstractController {
  // D2.7
  static get contractVersion() {
    return 2 as const;
  }
  async getUser(ctx: GetUserContext) {
    return HttpResponse.json(200, { user: ctx.appInfo.user });
  }
}
```

Migration for pass-through middleware: replace `(req, res, next)` with `(ctx, next)`, keep
`return next()`, replace `next(err)` with `throw err`, replace `res.status(...).json(...)` with a
returned `HttpResponse`, and move `res.on('finish')` work to `ctx.onFinish`.

## Files touched

- `src/services/http/pipeline.ts` (new) — the portable pipeline `(ctx) => Promise<HttpResponse>`:
  per-route composition at registration, strict-onion runner with production guards and development
  diagnostics, validation stage, raw-error unwind, registry resolution after unwind. No Express
  import; proven by a conformance suite without Express.
- `src/services/http/RequestContext.ts` (new) — the per-request class: lazy `method`, `path`, `url`,
  `route`, `headers`/`header()`, `params`, `query`, `body`, `ip`, `cookies`, `id`, `logger`,
  `signal`, `onFinish`, `appInfo`, `response` (staged headers and cookies).
- `src/services/http/middleware/AbstractMiddleware.ts` — `contractVersion`; v2 signature and its
  base type (see the open implementation question).
- `src/services/http/routing/ExpressAdapter.ts` — builds the context, enters the framework store,
  runs the pipeline; v1 entries through the existing bridge inside the chain.
- `src/controllers/index.ts` — v2 controllers: handlers get `ctx`; errors are not caught inside the
  wrapper (they travel up); v1 unchanged.
- `src/services/http/ExpressResponseWriter.ts`, `responses.ts` — staged headers and cookies merged
  into every response; internal "already sent" kind skipped; one completion seam for `onFinish`
  (`finished | aborted | failed`); cancel a replaced stream source.
- `src/services/http/HttpServer.ts`, `src/services/http/types.ts`, `src/index.ts` — `RequestContext`
  and `Next` types, `requestContext()` export, registry entry for the pipeline.
- `src/codegen/*` — per-route context types for v2 handlers; `appInfo` typing for `ctx`.
- `package.json` — `cookie` as a direct dependency.
- Tests: conformance suite ported from
  [contract-check.mjs](../reference/middleware-experiments/contract-check.mjs) (requirements and
  misuse cases) for the pipeline without Express; adapter, controller, writer and codegen tests;
  CI on Node 24, Node 26 and Bun.
- Docs (framework-documentation): middleware page rewrite with the migration table, controllers
  (v2 handlers), request context, cookies, AsyncLocalStorage; CHANGELOG `Unreleased`.

## What this removes / simplifies (v6)

| Today                                                                               | After                                                         |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `runMiddleware` `new Promise` + `settle` + `res.once('finish'/'close')` bookkeeping | one composed chain per route                                  |
| `next()` only resolves a promise; code after it runs before the handler             | `await next()` returns the response; code after it runs after |
| `next(err)` / mutate `res`                                                          | `throw` / return `HttpResponse`                               |
| `als.run(store, next)` silently does nothing                                        | wraps everything after the middleware                         |
| Express `req`/`res`/`next` threaded through middleware and handlers                 | one framework `ctx`                                           |
| Dispatch ≈ 4.7 µs for 10 middleware (v1 bridge)                                     | ≈ 1.2–2.7 µs on Node (measured kernels)                       |

## Out of scope

- Exact v6 raw-route API — P1q reserves an explicit adapter-specific escape hatch.
- Global Express middleware mounted via `app.express.use` (security headers, `RequestParser`,
  global `Cors`) stay Express middleware in v5; their move belongs to the Node adapter / Express
  removal plans.
- Static metadata getters — [static-middleware-cutover](../later/static-middleware-cutover.md).
- Native (Rust) validation or paired middleware — later, with their own gates
  ([astro-proposal](../reference/astro-proposal.md)).
- Per-request `beforeSend`, signed/encrypted cookies, sessions.

## Done when

- A v2 middleware `(ctx, next)` and a v2 controller handler `(ctx)` work in 5.7 next to v1 code on
  the same route, sharing `appInfo`.
- The pipeline runs without Express in tests and passes the conformance suite (requirements and
  misuse cases) on Node 24, Node 26 and Bun.
- Errors thrown in a v2 chain unwind wrappers before the registry; staged headers and cookies apply
  to error responses; `onFinish` fires exactly once.
- TypeScript rejects a forgotten `return next()` in a v2 middleware.
- The real runner is re-measured (heap, RSS, CPU, p95/p99) on Node 24, Node 26 and Bun.
- Docs and CHANGELOG updated; full suite, `check`, `check:types`, `check:types:tests`, `smoke` green.

## Trade-offs

- Every middleware writes `return next()`; in exchange there is one contract for every middleware.
- Production guards cost ≈ 0.6–0.8 KB per pending request and ≈ 0.3–1.8 µs per request more than
  the H alternative (measured; accepted by the owner for the simpler contract).
- 5.x pays one small `ctx` object per v2 request (80 B); v6 pays nothing extra.
