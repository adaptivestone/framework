# P1m — Async/await middleware contract (breaking)

**Status**: ▶ active — **contract settled 2026-11-01** (owner); implementation started the same day.
Progress (slices in [Implementation progress](#implementation-progress)): slices 1 (portable core),
2 (Express adapter), 3 (v2 controllers) and 4 (cookies) done; hook types, docs and Phase 2 next.
**Contract:** strict explicit-next onion — `middleware(ctx, next)` returns `next()` or an
`HttpResponse`, throws travel up through every middleware and the registry resolves them once.
Full contract, rules and measurements: [middleware-final-recommendation](../reference/middleware-final-recommendation.md);
decision record: D1 and D2 below.
**Target**: the next minor (5.7) as an opt-in — middleware extend the new `Middleware` base,
controllers set `static contractVersion = 2` — landing with
[P1q universal HTTP responses](universal-http-responses.md) (its writer renders the
returned responses). v6 flips the default, drops v1, migrates built-ins, together with
[static-middleware-cutover](../later/static-middleware-cutover.md).
**v6 stability**: this contract is part of the v6 public API that must last for years; it follows
the rules in [v6-api-stability](../queued/v6-api-stability.md) (options objects, framework-created `ctx`,
reserved `beforeSend` slot, no Express types).
**Depends on**: P1b ✅ (tree router / `ExpressAdapter`), P1q Phases 1–2 ✅ (writer, error
descriptors, `transformResponse`).

## Settled contract (2026-11-01)

| Decision                 | Outcome                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D2.1 flow                | Strict onion. `return next()` continues, a returned `HttpResponse` stops, a throw travels up unchanged; the registry resolves it once at the top.                                                                                                                                                                                    |
| Guards                   | Production: `next()` always returns a Promise, works once, expires when its own middleware call settles, is refused once the response is chosen; every started suffix is awaited; no misuse becomes an `unhandledRejection`; final value must be a response. Development: name the culprit. (Revised after the contract review.)     |
| v2 base class            | **Decided 2026-11-01:** a new `Middleware` base (`src/services/http/middleware/Middleware.ts`) for v2 middleware, typed `middleware(ctx, next): HttpResponse \| Promise<HttpResponse>`; `AbstractMiddleware` stays the v1 base and is removed in v6. The class says which contract it uses, so middleware need no `contractVersion`. |
| v5 bridge                | A v1 handler/middleware that wrote `res` itself yields a `sent` response kind, visible in the v5 response union and removed in v6; `Next` stays `Promise<HttpResponse>`. Full outcome rules below.                                                                                                                                   |
| D2.2 context             | A separate `RequestContext` object per v2 request in 5.x (80 B measured); `ctx.appInfo` is the same object as `req.appInfo`. Names: `route` (template), `url` (`URL`), `path` (decoded), `ip` (IpDetector), `cookies`.                                                                                                               |
| D2.3 state               | Keep `ctx.appInfo`, typed per route by codegen from `provides`; packages namespace their data.                                                                                                                                                                                                                                       |
| D2.4 staged headers      | `ctx.response.setHeader/appendHeader` apply to every response, errors included.                                                                                                                                                                                                                                                      |
| D2.5 cookies             | `ctx.cookies.get`, `ctx.response.setCookie/deleteCookie`, secure defaults; `cookie` becomes a direct dependency.                                                                                                                                                                                                                     |
| D2.6 store               | One framework AsyncLocalStorage store per request, on by default (`requestContext()`); `id`, `logger`, `signal`, `onFinish` lazy.                                                                                                                                                                                                    |
| D2.7 handlers            | v6 handlers receive the same `ctx` and return an `HttpResponse`; a 5.x controller opts in with `static contractVersion = 2`.                                                                                                                                                                                                         |
| Not in the first version | Per-request `beforeSend` hook; signed/encrypted cookies; sessions; typed-keys state API.                                                                                                                                                                                                                                             |

Order of one request: pipeline (middleware → validation → handler) → wrappers unwind → registry
once → global `transformResponse` → writer merges staged headers/cookies → `onFinish` exactly once
(`finished | aborted | failed`). All behaviour is identical on Node 24, Node 26 and Bun (checked).

## v5 opt-in bridge (approved 2026-08-31; contract revised 2026-11-01)

- **Middleware:** v2 classes extend the new `Middleware` base; v1 classes keep extending
  `AbstractMiddleware`. The adapter and codegen tell them apart by base class at registration.
- **Controllers** (D2.7) get `static get contractVersion(): 1 | 2` defaulting to `1` — the house
  static-getter pattern, readable with zero instantiation (handlers do not override a base method,
  so a flag works there).
- The adapter composes each route's chain once. **v2** entries run as strict-onion layers with a
  `RequestContext`; **v1** entries run through today's Promise bridge inside the chain, as a layer
  that continues when the old middleware calls `next()` and yields the "already sent" kind when it
  ended `res`.
- **Built-ins: unchanged v1 classes plus portable versions in 5.x (final review, 2026-11-01).**
  The existing v1 classes and their subclass signatures stay unchanged through v5 (flipping them
  would break every consumer subclass). **Phase 2 of this card** adds the app-wide middleware API
  and portable `Middleware` implementations of the built-ins (security headers, `RequestParser`,
  `Cors`, `IpDetector`, `I18n`, `RequestLogger`, and the route built-ins) next to them; the Node.js
  adapter runs the portable ones, the Express adapter keeps the v1 path. Their names/paths are
  chosen when Phase 2 starts. In v6 the v1 classes are removed and the portable ones remain.
- v5 docs mark v1 deprecated with a mechanical migration table; consumers migrate class by class.
- v6: `AbstractMiddleware`, v1 dispatch and the Promise bridge are deleted, built-ins move to
  `Middleware`, controllers default to v2 and their `contractVersion` becomes vestigial (kept one
  major as a no-op or dropped — decide at cutover).
- **v2 base class — decided 2026-11-01 (option A):** a separately typed `Middleware` base, the v2
  import in 5.x and v6, sharing static metadata and helpers with `AbstractMiddleware` (not a base
  widened to `any`/`void`). Why: TypeScript rejects a v2 override of `middleware(ctx, next)` on the
  v1 base `middleware(req, res, next)` (TS2416), and the forgotten-`return` check needs the strict
  base type. Affects `typeof AbstractMiddleware` constraints in `src/modules/AbstractController.ts`,
  `routing/RouteNode.ts` (`MiddlewareEntry`) and `routing/middlewareNormalization.ts`, which must
  accept both bases.
- **v1 code inside a v2 chain — decided 2026-11-01 (option A):** a v1 controller handler or
  validator running inside the portable chain keeps its `(req, res, next)` call, but its errors
  escape to the outer v2 wrappers before the registry (so a v2 transaction rolls back); the old
  standalone v1 dispatch keeps normalising inside the controller wrapper. A v1 middleware's
  `next(err)`, synchronous throw and rejection pass the original value through (today's `settle`
  wraps non-`Error` values and ignores falsy ones — not copied).
- **Legacy terminal outcomes in v5** (contract review):

  | Legacy event                                                 | Bridge behaviour                                                                                                                                                                                     |
  | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | v1 middleware calls `next()`                                 | Advance exactly once with legacy callback semantics; the suffix runs inside any enclosing v2 context. A v1 middleware's own ALS scope gains no wrapping semantics.                                   |
  | v1 handler returns `void` / pipes to `res` before any byte   | Track the pending legacy send explicitly; do not produce `sent` while nothing has started (today's adapter allows a later raw write).                                                                |
  | v1 code commits headers/body                                 | Flush already-staged `ctx.response` headers and cookies at the legacy write boundary (`on-headers`); staging after the commit throws instead of being silently lost.                                 |
  | v1 response finishes normally                                | Yield `sent`; skip transform/render; deliver `onFinish` once, also when the legacy response finished before the bridge unwound.                                                                      |
  | v1 response closes prematurely                               | Reject with the request's abort reason; `onFinish` reports `aborted` (today's bridge treats `close` as success — not reused unchanged). A lazy `ctx.signal` reflects an abort that already happened. |
  | outer middleware replaces `sent`, or throws after raw commit | Report the misuse or failure without attempting a second HTTP response; decide from the real transport state, not from the returned object.                                                          |

  `sent` is part of the v5 `HttpResponse` union (documented, not hidden by a cast): it is an
  already committed side effect, not a replaceable response. Descriptor-path ordering does not
  apply retroactively to legacy raw writes.

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
    cb: (result: {
      outcome: 'finished' | 'aborted' | 'failed'; // server-side completion, not client receipt
      status?: number; //                       the status sent, when one was sent
      error?: unknown; //                       for 'failed'
      durationMs: number; //                    from request entry
    }) => void,
  ): void; //                                   exactly once across finish/close/error races
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
  `http://localhost` (outside production only — see slice 4); the `cookie` package becomes a
  direct dependency (today it only arrives through Express). Not now: signed/encrypted cookies, sessions. Original text: the framework
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

## Implementation progress

**Slice 1 — portable core (done 2026-11-01, not wired to any adapter yet):**

- `src/services/http/middleware/BaseMiddleware.ts` — static metadata and construction shared by
  both contracts; `AbstractMiddleware` now extends it (its public surface is unchanged:
  deprecated aliases, `translate(req)`, `middleware(req, res, next)`, `getMiddleware()`).
- `src/services/http/middleware/Middleware.ts` — the v2 base: abstract
  `middleware(ctx, next): HttpResponse | Promise<HttpResponse>`, `translate(ctx, …)`.
- `src/services/http/RequestContext.ts` — the context class over an adapter's `RequestSource`
  (lazy `method`, `path`, `url`, `route`, `headers`/`header()`, `params`, `query`, `body`, `ip`,
  `id`, `signal`, `appInfo`, `error`/`failed`), `ResponseStaging` (`setHeader`, `appendHeader`,
  sealed when the response starts), `onFinish` (exactly once, newest first, contained,
  in the request scope), and the `Next` / `FinishResult` types. `logger` waits for the P1z logger
  contract; `cookies` comes with slice 4.
- `src/services/http/requestScope.ts` — `requestContext()` and the internal `runInRequestScope`.
- `src/services/http/pipeline.ts` — `composeChain` (strict onion with the production guards and
  optional diagnostics), `middlewareLayer`, `handleRequest` (request scope + registry once).
- `src/tests/createTestContext.ts` — `createTestContext()` / `finishTestContext()` for tests.
- `src/helpers/translate.ts` — accepts anything carrying `appInfo.i18n` (a request or a context).
- Tests: `pipeline.test.ts` (every requirement and guard case from `contract-check.mjs`, with and
  without diagnostics), `RequestContext.test.ts`, `middleware/Middleware.test.ts` (including the
  compile-time forgotten-`return` check against the real base). 47 tests on Node 24, Node 26 and
  Bun; full suite 1 075/1 075 on Node 24 and 26.

**Slice 2 — Express adapter (done 2026-11-01):**

- A route whose middleware include a v2 `Middleware` runs as a strict-onion chain
  (`routing/expressPipeline.ts`); routes with only 5.x middleware keep the 5.x dispatch unchanged.
- Route types accept both bases: `MiddlewareClass` / `V2MiddlewareClass` in `RouteNode`,
  `AbstractController`'s `TMiddleware`, `middlewareNormalization`.
- 5.x middleware inside the chain keep `(req, res, next)`: `next()` continues after their own
  synchronous code and outside an AsyncLocalStorage scope they opened (`AsyncLocalStorage.snapshot`);
  `next(err)`, a throw or a rejection fail the chain with the original value; ending the response
  yields `sent`.
- The controller wrapper is split: `entry.rawHandler` (validation + handler, errors escape) runs in
  the chain; `entry.handler` (the 5.x wrapper) is unchanged. Error resolution moved to
  `services/http/answerError.ts` (`answerError`, `validationFallback`, validation-stage marking), so
  a v2 chain answers exactly what the 5.x controller would: registry, validation 400 fallback for
  validation-stage errors only, otherwise a logged 500.
- `HttpResponse` union gains `sent` (v5 only; internal `legacySentResponse`); the writer and
  `transformResponse` skip it.
- Transport: staged headers applied before the writer (descriptor headers win) or flushed when
  5.x code commits headers (`writeHead`; 5.x headers win), then sealed; `onFinish` from
  `finish`/`close` (`finished` / `aborted` / `failed`); `ctx.signal` lazy and aborted for a client
  that already left; a response 5.x code already sent is never written twice (a replacement is
  logged).
- Diagnostics are on whenever `NODE_ENV` is not `production`.
- Tests: `routing/expressPipeline.test.ts` (12, real HTTP): early stop, staged headers on returned,
  error and 5.x responses, `onFinish`, `requestContext()` in a 5.x handler, rollback on a handler
  error, validation 400, logged 500, 5.x middleware continue / `next(err)` identity / answering,
  5.x handler writing `res`, refused late staging, replaced `sent` response, client abort.

**Slice 3 — v2 controllers (done 2026-11-01):**

- `AbstractController.contractVersion` (static, default `1`). A controller returning `2` gets
  `handler(ctx)`; the handler must return an `HttpResponse` (anything else is a `TypeError`,
  answered as a logged 500). The contract is taken from the class that declares the method, so a
  method inherited from a 5.x parent keeps `(req, res)`; an inline function takes the controller's.
- `HandlerEntry.contract`; a route with a v2 handler always runs as a strict-onion chain (even with
  only 5.x middleware), and the chain passes `ctx` to the route's validation + handler
  (`rawHandler`). Validation, the 415 for an unknown content type, the registry and the validation
  400 fallback are unchanged; `ctx.appInfo` is the same object validation fills.
- Codegen emits `<MethodName>Context = ValidatedContext<<MethodName>Request>` next to every
  request type (`ValidatedContext` in `services/http/types.ts`): same validated `appInfo` and path
  params by name. Unknown param names still type as `string`, as on 5.x `req.params` (the Express
  index signature) — narrowing that is a v6 typing change.
- Tests: `controllers/contractVersion.test.ts` (7, real HTTP: context with validated input and
  `requestContext()`, validation 400, params and route template, registry 404, missing
  `HttpResponse` → logged 500, inherited 5.x method, v2 middleware + v2 handler sharing `appInfo`
  and staged headers); golden codegen fixture `ContextHandlers.ts` (tsc reads validated input,
  path params and the inherited `Auth` user through the generated context types).
- Not in this slice: portable types for `transformResponse` and error handlers (they still receive
  `req`). Their shape is an open owner question; it is still required before P1m is done.

**Slice 4 — cookies (done 2026-11-01):**

- `ctx.cookies.get(name)` (`RequestCookies`, parsed from the `Cookie` header on first read,
  URL-decoded, own keys only; several `cookie` headers join with `; `).
- `ctx.response.setCookie(name, value, options)` / `deleteCookie(name, options)` stage `Set-Cookie`
  values keyed by name + domain + path (the same identity replaces); staged cookies come after
  staged headers, so they reach returned, early-stop, error and 5.x-written responses through the
  existing staging path. A descriptor's own `Set-Cookie` is appended after them.
- Defaults `Path=/`, `HttpOnly`, `SameSite=Lax`, `Secure`. The `http://localhost` exception
  (loopback and `*.localhost` too) applies **outside production only**: nginx's default
  `proxy_pass http://localhost:…` forwards `Host: localhost`, so without `trust proxy` a production
  app would otherwise drop `Secure`. `maxAge` is in seconds (the attribute's unit; Express's
  `res.cookie` uses milliseconds — called out in the CHANGELOG). Invalid names, values, domains or
  paths throw (the `cookie` package validates).
- `cookie@^2.0.1` is a direct dependency (ESM, no dependencies, Node ≥ 22); Express keeps its own
  0.7 copy until v6.
- Packaging smoke: `scripts/fixtures/middleware-v2.mts` type-checks against the packed package (v2
  middleware, forgotten `return next()` rejected, both middleware versions in real registration
  forms, a `contractVersion = 2` controller, `createTestContext`); the runtime check runs a v2
  middleware with cookies and `requestContext()` from the installed dist.
- Tests: `RequestContext.test.ts` (+9 cookie cases: parsing, defaults, localhost and production,
  overrides, replace, delete, order, invalid input, late staging); `expressPipeline.test.ts` (+4
  over HTTP: returned response with its own `Set-Cookie`, error response, 5.x-written response,
  delete).

**Still open for P1m:** portable types for `transformResponse` and error handlers (owner question),
the response-type consumer fixture with a simulated added kind (with P1q), docs, the real-runner
re-measure, and Phase 2 (app-wide middleware API and portable built-ins).

## API change

```ts
// BEFORE (v5.x, v1)
class GetUserByToken extends AbstractMiddleware {
  async middleware(req, res, next) {
    req.appInfo.user = await resolveUser(req);
    return next();
  }
}

// AFTER (v2 opt-in in 5.7, the only form in v6)
class GetUserByToken extends Middleware {
  async middleware(ctx, next) {
    ctx.appInfo.user = await resolveUser(ctx);
    return next();
  }
}

class RateLimiter extends Middleware {
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

Migration for pass-through middleware: extend `Middleware` instead of `AbstractMiddleware`,
replace `(req, res, next)` with `(ctx, next)`, keep
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
- `src/services/http/middleware/AbstractMiddleware.ts` — shared static metadata moves to a place
  both bases use; v1 signature unchanged.
- `src/services/http/routing/ExpressAdapter.ts` — builds the context, enters the framework store,
  runs the pipeline; v1 entries through the existing bridge inside the chain.
- `src/controllers/index.ts` — v2 controllers: handlers get `ctx`; errors are not caught inside the
  wrapper (they travel up); v1 unchanged.
- `src/services/http/ExpressResponseWriter.ts`, `responses.ts` — staged headers and cookies merged
  into every response; internal "already sent" kind skipped; one completion seam for `onFinish`
  (`finished | aborted | failed`); cancel a replaced stream source.
- `src/services/http/HttpServer.ts`, `src/services/http/types.ts` — `RequestContext` and `Next`
  types, registry entry for the pipeline.
- `src/tests/createTestContext.ts` (new) — the public test factory for `RequestContext`, imported as
  `@adaptivestone/framework/tests/createTestContext.js` (the `./tests/*` export), so apps never
  hand-build contexts and `RequestContext` can grow in minors.
- Public response type: a forward-compatible representation so supported narrowing and
  pass-through code keeps compiling when a kind is added in a minor
  ([v6-api-stability](../queued/v6-api-stability.md) decision 2), plus a consumer type fixture that adds a
  simulated kind.
- Phase 2: the app-wide middleware API and the portable built-ins (see the bridge section).
- `src/services/http/requestScope.ts` (new) — the `requestContext()` accessor, side-effect free,
  imported as `@adaptivestone/framework/services/http/requestScope.js` (the `./services/*`;
  not `requestContext.ts`, which would collide with `RequestContext.ts` on case-insensitive file
  systems)
  export); `src/index.ts` boots a server and is not a package export. Packaging smoke imports it.
- `src/services/http/middleware/Middleware.ts` (new v2 base), `src/modules/AbstractController.ts`, `routing/RouteNode.ts`,
  `routing/middlewareNormalization.ts` and their tests — mixed v1/v2 middleware lists and tuples.
- Controller version recorded when methods become bound `HandlerEntry` functions; defaults for
  ad-hoc handlers and inheritance (a subclass changing its version must not call an inherited v1
  method as `(ctx)`); tests for discovery, class/instance registration and ad-hoc routes.
- `src/server.ts`, `services/http/builtinErrorHandlers.ts` — `TransformResponseHook`,
  `ErrorHandlerFn` and registry calls receive Express-derived `FrameworkRequest` today: give the
  portable core framework-owned types and keep explicit v5 adapters.
- Request entry vs route context: define how parser failures and 404/405 (outside a matched route)
  get context and completion behaviour, or limit the first release's guarantee explicitly.
- `src/codegen/*` — per-route context types for v2 handlers next to the request aliases (or the
  controller version carried through the AST model); `appInfo` from `provides` and schema outputs
  preserved in both forms; type fixtures.
- `package.json` and `package-lock.json` — `cookie` as a direct dependency; acceptance cases for
  cookie/header precedence, error responses, append/delete and legacy commits.
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
| Dispatch ≈ 4.7 µs for 10 middleware (v1 bridge)                                     | ≈ 1.1–6.4 µs on Node with complete guards (kernels)           |

## Out of scope

- Exact v6 raw-route API — P1q reserves an explicit adapter-specific escape hatch.
- Removing the Express-mounted v1 globals — they stay for the Express adapter until v6; their
  portable replacements are Phase 2 above (prerequisite of the [Node adapter](../later/node-adapter.md)).
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
- TypeScript rejects a forgotten `return next()` (sync, async, one branch) against the real
  exported v2 base, and both versions compile in real route registration forms (type fixtures
  against the packed package).
- Mixed routes: a v1 handler error inside a v2 transaction rolls it back; every legacy outcome row
  above has a test.
- Guards: per-invocation expiry, waiting for started cleanup, `next()` Promise parity in
  production and development — the cases in `contract-check.mjs` and
  [contract-review-probes.mjs](../reference/middleware-experiments/contract-review-probes.mjs).
- Real response completion and cancellation over HTTP: first-chunk and later-chunk abort,
  cancellation failure, replaced source, one completion notification with the framework context
  restored.
- Extension hooks (`transformResponse`, error handlers) have portable types or explicit legacy
  adapters; the new public imports work from the packed package.
- Guards also cover the final-review cases: a late call after a forwarding middleware finished
  keeps the chosen response; development diagnostics never leave an `unhandledRejection`.
- `createTestContext()` works from the packed package (packaging smoke), and the response-type
  consumer fixture compiles with a simulated added kind.
- Phase 2: the app-wide middleware API and the portable built-ins pass the same behaviour tests as
  their v1 classes, without Express.
- The real runner is re-measured (heap, RSS, CPU, p95/p99) on Node 24, Node 26 and Bun.
- Docs and CHANGELOG updated; full suite, `check`, `check:types`, `check:types:tests`, `smoke` green.

## Trade-offs

- Every middleware writes `return next()`; in exchange there is one contract for every middleware.
- Complete production guards cost ≈ 2.2 KB per pending request and ≈ 2–4 µs per request more than
  the H alternative on a realistic route (re-measured after the final review; the owner accepted a
  memory difference for the simpler contract — ≈ 0.8 KB before the reviews completed the guards).
- 5.x pays one small `ctx` object per v2 request (80 B); v6 pays nothing extra.
