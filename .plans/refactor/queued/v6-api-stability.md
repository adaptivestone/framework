# v6 API stability — settle before v6 so it lasts

**Status**: ⏸ queued — created 2026-11-01 at the owner's request: v6 must stay the current major
for years; a later feature (new middleware ability, new adapter, new response kind) must ship in a
6.x minor, never force a v7.
**Kind**: cross-cutting checklist. Each item names the plan that implements it; this card only
tracks that the v6 public API is extensible and Express-free before v6 is released.
**Depends on**: [P1m async middleware](async-middleware.md), [P1q universal responses](../active/universal-http-responses.md),
[static-middleware-cutover](../later/static-middleware-cutover.md), [node-adapter](../later/node-adapter.md),
[default-node-adapter](../later/default-node-adapter.md), [drop-express](../later/drop-express.md),
[P1z logging](logging-facade-and-pino.md), [observability](../later/observability.md).

## Why this card exists

The Node adapter (P3), default Node adapter (P4) and Express removal (P5) come after v6. If any part
of the v6 public API still depends on Express, those phases become breaking changes — a v7. Today
the documentation tells apps to call `app.httpServer.express.use(...)` for global middleware and to
register Express template engines on `app.httpServer.express`
(`framework-documentation/docs/06-Controllers/01-intro.md`), and error handlers and
`transformResponse` receive the Express-derived `FrameworkRequest`.

## Design rules for every v6 public API

1. **Objects, not positions, for anything that can grow.** Hooks are called as
   `(value, { ctx, … })`; callbacks receive one result object (`onFinish({ outcome, status, … })`);
   factories take an options object. Adding a field is a minor change.
2. **Apps read framework objects, they never implement them.** `RequestContext` and response
   objects are created by the framework only. Tests get `createTestContext()` instead of
   hand-built objects, so adding a member to `RequestContext` stays a minor change.
3. **Open or frozen sets are stated, not implied.** `HttpResponse` kinds and `onFinish` outcomes
   are either declared open (docs and types say: pass unknown kinds through) or frozen for v6 —
   decision 1 below.
4. **No Express or Node types in the public surface** — types, docs, examples. Transport-specific
   access only through an escape hatch whose contract says it belongs to one adapter — decision 2.
5. **Reserved lifecycle positions are written down now.** The order of one request is fixed in
   [P1m](async-middleware.md), with the slot for a future per-request `beforeSend` (between error
   resolution and `transformResponse`) reserved, so adding the hook later reorders nothing.
6. **One extension point per concern.** Request flow: strict-onion `Middleware`. Per-request data:
   `appInfo` + `provides`. Errors: the error registry. Global response shape: `transformResponse`.
   Instrumentation: tracing channels. New features plug into these instead of adding mechanisms.
7. **Versioned contracts stay opt-in.** The `Middleware` base class (v2) and controller
   `contractVersion` are how a future contract revision can be offered in a minor and made the
   default later.

## Must be settled before v6 ships

| #   | Item                        | Today                                                                                                                                   | Needed in v6                                                                                                                    | Implemented by                     |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | App-wide middleware         | Express `express.use` (security headers, `RequestParser`, `Cors`, `IpDetector`, `I18n`, `RequestLogger`); docs tell apps to do the same | A framework API to register app-wide `Middleware` on the strict-onion contract; built-ins move onto it                          | P1m, static-middleware-cutover     |
| 2   | Express exposure            | `app.httpServer.express` is public and documented                                                                                       | Decision 2: removed from the public API, or kept only as an Express-adapter escape hatch                                        | P1q (v6), drop-express             |
| 3   | Adapter selection           | Express, implicit                                                                                                                       | The adapter is named in config; the Node adapter can ship as an opt-in 6.x minor; decision 3 on when the default may change     | node-adapter, default-node-adapter |
| 4   | Raw transport routes        | WebSocket upgrade, `CONNECT`, socket ownership deferred in P1q                                                                          | The opt-in shape defined (even if only one adapter implements it at first)                                                      | P1q (v6)                           |
| 5   | Hook signatures             | `ErrorHandlerFn(err, req)`, `transformResponse(response, { req })` with Express `FrameworkRequest`                                      | `(value, { ctx })` with the portable `RequestContext`                                                                           | P1m, P1q                           |
| 6   | Controller handlers         | `(req, res)`                                                                                                                            | `(ctx) => HttpResponse` with per-route context types (D2.7)                                                                     | P1m, P1q                           |
| 7   | Request body                | parsed by the global Express `RequestParser`                                                                                            | per-route parsing mode (exists: `bodyParsing`), parsed `ctx.body`, and a reserved raw/streaming body accessor for large uploads | P1m (D2.2)                         |
| 8   | Response kinds and outcomes | closed unions in the types                                                                                                              | decision 1: declared open or frozen                                                                                             | P1q, P1m                           |
| 9   | Test helpers                | `getTestServerURL` and friends                                                                                                          | `createTestContext()` so `RequestContext` can grow                                                                              | P1m                                |
| 10  | Lifecycle order             | defined in P1m                                                                                                                          | the `beforeSend` slot reserved in the spec                                                                                      | P1m                                |
| 11  | Logger contract             | `ctx.logger` planned                                                                                                                    | its type is the framework logger interface from P1z, settled before v6                                                          | P1z                                |
| 12  | Instrumentation names       | none                                                                                                                                    | tracing channel names fixed, or published as experimental until stable                                                          | observability                      |

## Can ship after v6 in minors (by design)

Per-request `beforeSend`; signed/encrypted cookies; sessions; a typed-keys state API; new `ctx`
members; new response kinds (if decision 1 = open); the Node adapter as an option, Bun/Deno adapters,
HTTP/2; native validation and paired Rust middleware (internal backends behind the same contracts);
tracing channels (if experimental); new built-in middleware.

## Decisions for the owner (one at a time)

1. `HttpResponse` kinds and `onFinish` outcomes: declared open, or frozen for v6.
2. `app.httpServer.express` in v6: removed from the public API, or kept as an Express-adapter
   escape hatch outside the stability promise.
3. The default adapter: Express for all of v6, or allowed to change in a 6.x minor once items 1–2
   are done.

## Done when

Every row above is either implemented in its plan or explicitly decided, the v6 migration guide
lists no Express API, and a public-surface check (types and docs) finds no Express or Node types
outside the escape hatch.
