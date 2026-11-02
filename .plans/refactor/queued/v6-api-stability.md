# v6 API stability — settle before v6 so it lasts

**Status**: ⏸ queued — created 2026-11-01 at the owner's request: v6 must stay the current major
for years. **Stable means no breaking changes, not no changes** (owner): what is decided now holds
for years, and a later need (new middleware ability, new adapter, new response kind) is added in a
6.x minor without breaking apps — never a v7. **Corrected the same day:** removing Express is the v6 milestone
itself (owner) — 5.x makes Express optional with a Node.js adapter, v6 removes the Express adapter.
**Kind**: cross-cutting checklist. Each item names the plan that implements it; this card tracks
that, when v6 ships, Express is gone and every public API can grow in minors.
**Depends on**: [P1m async middleware](../done/async-middleware.md), [P1q universal responses](../active/universal-http-responses.md),
[static-middleware-cutover](../later/static-middleware-cutover.md), [node-adapter](../later/node-adapter.md),
[default-node-adapter](../later/default-node-adapter.md), [drop-express](../later/drop-express.md),
[P1z logging](logging-facade-and-pino.md), [observability](../later/observability.md).

## Roadmap (owner target, 2026-11-01)

```
5.x  P1q responses ✅ → P1m portable pipeline (opt-in Middleware, ctx, handlers) →
     app-wide middleware API → Node.js adapter (P3) as an option; Express becomes optional
     and is deprecated together with everything that exposes it
v6   the Express adapter and the `express` dependency are removed (P5's Express part);
     the Node.js adapter is the HTTP adapter; v1 middleware/handlers are removed (P1m, P1q)
6.x  additive only: Bun/Deno/Fetch adapters, HTTP/2 options, new response kinds (if open),
     beforeSend, cookie signing, sessions, native validation — all minors
```

## Design rules for every v6 public API

1. **Objects, not positions, for anything that can grow.** Hooks are called as
   `(value, { ctx, … })`; callbacks receive one result object (`onFinish({ outcome, status, … })`);
   factories take an options object. Adding a field is a minor change.
2. **Apps read framework objects, they never implement them.** `RequestContext` and response
   objects are created by the framework only. Tests get `createTestContext()` instead of
   hand-built objects, so adding a member to `RequestContext` stays a minor change.
3. **Sets are complete at v6 and may only grow.** `HttpResponse` kinds and `onFinish` outcomes are
   decided now (decision 2); docs and types tell apps to pass kinds they do not handle through, so a
   kind added later in a minor is not a breaking change.
4. **No transport types in the public surface** — no Express, and no Node `IncomingMessage` /
   `ServerResponse` outside an explicit raw-transport route (item 4), so Bun/Deno/Fetch adapters
   can be added in 6.x minors.
5. **Reserved lifecycle positions are written down now.** The order of one request is fixed in
   [P1m](../done/async-middleware.md), with the slot for a future per-request `beforeSend` (between error
   resolution and `transformResponse`) reserved, so adding the hook later reorders nothing.
6. **One extension point per concern.** Request flow: strict-onion `Middleware`. Per-request data:
   `appInfo` + `provides`. Errors: the error registry. Global response shape: `transformResponse`.
   Instrumentation: tracing channels. New features plug into these instead of adding mechanisms.
7. **Versioned contracts stay opt-in.** The `Middleware` base class and controller
   `contractVersion` are how a future contract revision can be offered in a minor and made the
   default later.

## Must be done before v6 ships

| #   | Item                        | Today                                                                                                                                   | Needed                                                                                                                                                                                                     | When / plan                         |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | App-wide middleware         | Express `express.use` (security headers, `RequestParser`, `Cors`, `IpDetector`, `I18n`, `RequestLogger`); docs tell apps to do the same | The `Server` option `middleware` (done, P1m Phase 2a) and the built-ins converted in place to `Middleware` (owner decision 2026-11-01; P1m Phase 2b). Prerequisite of the Node adapter                     | 5.x before P3 — P1m Phase 2         |
| 2   | Express in the public API   | `app.httpServer.express` is public and documented (global middleware, template engines); `FrameworkRequest extends express.Request`     | Deprecated in 5.x with replacements in place; removed in v6 (no escape hatch: the Express adapter itself is gone)                                                                                          | 5.x deprecate, v6 remove — P1q, P5  |
| 3   | Adapter selection           | Express, implicit                                                                                                                       | 5.x: the adapter is chosen in config, Node.js adapter available; v6: Node.js adapter only. Default from a later 5.x minor (decision 1: B)                                                                  | 5.x — P3, P4                        |
| 4   | Raw transport routes        | WebSocket upgrade, `CONNECT`, socket ownership deferred in P1q                                                                          | The opt-in shape defined on the Node.js adapter                                                                                                                                                            | before v6 — P1q, P3                 |
| 5   | Hook signatures             | `ErrorHandlerFn(err, req)`, `transformResponse(response, { req })` with Express `FrameworkRequest`                                      | `(value, { ctx })` with the portable `RequestContext`                                                                                                                                                      | 5.x opt-in, v6 only form — P1m, P1q |
| 6   | Controller handlers         | `(req, res)`                                                                                                                            | `(ctx) => HttpResponse` with per-route context types (D2.7)                                                                                                                                                | 5.x opt-in, v6 only form — P1m, P1q |
| 7   | Request body                | parsed after routing per route mode (P1m 2b-3)                                                                                          | per-route parsing mode (exists: `bodyParsing`), parsed `ctx.body`, `ctx.rawBody` (`'raw'`) and `ctx.bodyStream` (`'none'`, a standard `ReadableStream`) — done in 5.x; `ctx.request` (Fetch view) reserved | 5.x — P1m (D2.2), P3                |
| 8   | Response kinds and outcomes | closed unions in the types                                                                                                              | decided (B): complete list now incl. `file`, `sse`; may only grow — needs a forward-compatible public type and a consumer fixture proving narrowing/pass-through code compiles after a kind is added       | before v6 — P1q, P1m                |
| 9   | Test helpers                | `getTestServerURL` and friends                                                                                                          | `createTestContext()` at `tests/createTestContext.js`, checked from the packed package, so `RequestContext` can grow                                                                                       | 5.x — P1m                           |
| 10  | Lifecycle order             | defined in P1m                                                                                                                          | the `beforeSend` slot reserved in the spec                                                                                                                                                                 | done in P1m                         |
| 11  | Logger contract             | `ctx.logger` planned                                                                                                                    | its type is the framework logger interface from P1z, settled before v6                                                                                                                                     | before v6 — P1z                     |
| 12  | Instrumentation names       | none                                                                                                                                    | tracing channel names fixed, or published as experimental until stable                                                                                                                                     | before v6 — observability           |
| 13  | Express-only packages       | apps can mount any Express middleware (passport, multer, template engines) on `app.httpServer.express`                                  | decided (A): migration guide lists replacements; no bridge                                                                                                                                                 | 5.x docs + migration guide          |

## Can ship after v6 in minors (by design)

Per-request `beforeSend`; signed/encrypted cookies; sessions; a typed-keys state API; new `ctx`
members; new response kinds when a real need appears (decision 2); Bun, Deno and Fetch-style adapters; HTTP/2
options; native validation and paired Rust middleware (internal backends behind the same
contracts); tracing channels (if experimental); new built-in middleware; possible future features not in the
framework today: compression, static files, sessions, a Connect-style bridge (only on real demand).

## Decisions for the owner (one at a time)

1. **Decided 2026-11-01: B.** The Node.js adapter ships in 5.x as an opt-in, becomes the default in a
   later 5.x minor (after one release as an option), and Express stays a deprecated opt-in until v6
   removes it.
2. **Decided 2026-11-01: B.** v6 starts with a complete list — `json`, `text`, `bytes`, `stream`,
   `file`, `sse`, `redirect`, `empty`, `native` (`file` and `sse` land before v6) — and `onFinish`
   outcomes `finished`, `aborted`, `failed`. If a real need appears later, a kind is added in a minor;
   apps pass unknown kinds through, so the addition does not break them.
3. **Decided 2026-11-01: A, no bridge.** The v6 migration guide lists a replacement for each need:
   framework features for CORS, body and upload parsing, rate limiting, security headers, request
   logging, token auth and i18n; a template engine called directly with the HTML returned as a
   `text` response; `HttpResponse.file` for downloads; compression and static files at a proxy or
   CDN. If real apps hit a blocker, a Connect-style bridge can still be added in a 6.x minor.

## Done when

Rows are of two kinds, and a decision alone completes neither (final review, 2026-11-01):

- **Required capabilities** (rows 1, 3, 4, 5, 6, 7, 9, 11, 13) — done when the API is implemented,
  tested, documented and covered in the migration guide.
- **Policies** (rows 2, 8, 10, 12) — done when the rule is written into the public docs and backed by
  a check: the public-surface check, the response-type consumer fixture, the lifecycle spec.

v6 ships without the `express` dependency; the migration guide lists the replacement for every
Express API; a public-surface check (types and docs) finds no Express or Node transport types
outside the raw-transport routes.
