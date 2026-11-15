# Astro Proposal

**Date:** 2026-11-01. **Status:** proposal for review, not an approved runtime contract.
**Decision (2026-11-01):** the owner chose the strict onion; contract and rules in
[middleware-final-recommendation](middleware-final-recommendation.md).
**Baseline:** `ccr-80ccfb40-0qs0lo` at `c18d732d5be812dbb1a6638974147c158b073f09`.
**Latest scope review:** `bb68b44f9187dd43a0455db1b1dc6afe83e3f96b` (runtime unchanged).
**Current objective:** finish the portable response/middleware contract so Express becomes an
adapter and can be removed. Native transport/validation capabilities are future compatibility
considerations. This document contains research and proposed contracts, not runtime changes.

**Review handoff (2026-11-01):** the owner requested this document and its concrete
[onion/H API comparison](#api-comparison-for-review-auth-als-and-completion-logging) be recorded
for Opus review. The author's recommended candidate is strict onion. D2.1 remains open pending
review and the owner's final decision; this handoff does not authorize implementation.

This revisits [D1/D2.1](../queued/async-middleware.md), the
[existing options](middleware-design-proposals.md), and the
[native engine spike](../queued/http-engine-spike.md). The owner now permits explicit
`return next()` in ordinary middleware and substantial redesign. The old requirement that
BEFORE-only middleware must not mention `next` is therefore no longer a constraint for this
proposal. Earlier reviewer recommendations made under that constraint remain historical evidence.

**Owner clarification (2026-11-01):** native execution means route schemas exported as JSON Schema
for a Rust validator, and selected middleware with separately authored JS and Rust implementations
of the same behavioral contract. This is the intended architecture below. The first revision put
too much emphasis on an automatic source-translation scenario that was not being proposed.

## Recommendation and the remaining disagreement

Astro recommends **one explicit response-returning onion contract**, with a framework request
context and separate response-preparation/completion lifecycle points. Its purpose now is to
remove Express from the application contract while supporting async short-circuits, ALS and
wrapping. The `next` here is a framework continuation returning a response; it is not Express's
`NextFunction`. Do not adopt B's
auto-continue/forgotten-return rules. Keep **H (explicit stages plus explicit wrappers)** as the
serious alternative if its memory advantage justifies two execution contracts in representative
applications. Neither model should dictate whether the transport or selected operations use Rust.

**Scope correction:** the core recommendation still fits the Express-removal goal, but the earlier
delivery path gave future native capabilities too much weight and omitted the explicit adapter
cutover. No Rust backend, native capability registry, ABI, execution-plan IR or backend-selection
API is required to deliver the current middleware change. Keep the existing response descriptors,
validation-driver boundary and static route metadata; those already provide places for future
implementations. The native sections below describe later options, not acceptance criteria now.

An independent GPT-6.1 Sol review prefers **H**, because ordinary request stages can finish and
release their frames before the handler waits. Sol agrees that strict onion is the simpler public
API, that the old B benchmark does not measure it, and that small production differences would
weaken H's justification. This is an actual disagreement about the simplicity/memory trade-off,
not disagreement about ALS or tracing correctness. See the evidence and decision gate below.

Shared conclusions:

- Framework-owned ALS and full framework tracing work with either model.
- An application's own ALS/span scope around subsequent middleware needs a real continuation.
- Raw errors must unwind application wrappers before registry normalization if ordinary
  `try/catch/finally` semantics are promised.
- A handler returning a response descriptor and a transport finishing that response are different
  events. Streams make this distinction unavoidable.
- A route can keep its JS/TS declaration while a Rust engine validates its supported JSON Schema.
  A middleware capability can likewise select between paired JS and Rust implementations with
  equivalent behavior. These are independent of the public continuation model.

## What is already implemented on this branch

The [P1q response bridge](../active/universal-http-responses.md) is real: `responses.ts`,
`ExpressResponseWriter`, framework error descriptors, and the `transformResponse` Server option
exist. The adapter awaits the handler, then writes its returned descriptor.

The middleware loop in `ExpressAdapter.ts` still uses the v1 callback bridge. The controller
wrapper in `controllers/index.ts` still catches validation/handler errors and returns their
registry responses. Merely adding an awaitable `next` outside that wrapper would not make errors
observable by a transaction wrapper. This boundary must deliberately change for v2 execution;
the existing v1 bridge must remain compatible during v5.

`RequestContext` is still a proposed interface. Reusing the Express request in v5 can avoid an
extra wrapper object, but portability needs executable conformance, not a type assertion. For
example, Express `req.route` is an object, whereas the proposal calls `ctx.route` a string; a new
portable field such as `routeTemplate` avoids overwriting legacy semantics. Lazy properties must
also avoid collisions with Express's existing `path`, `url`, `query`, and header APIs.

### Remaining Express boundaries

The source supports the owner's direction: routing and the response value are already owned by
the framework. The remaining coupling is concentrated, but includes the listener, public request
types and global middleware as well as registry middleware.

| Boundary                 | Current source                                                                                                                                                                                                                                       | Migration consequence                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Route matching           | [`RouteRegistry.match(method, path)`](../../../src/services/http/routing/RouteRegistry.ts) is independent of Express.                                                                                                                                | Reuse the matcher and route declarations.                                                                      |
| Response values/writer   | [`responses.ts`](../../../src/services/http/responses.ts) and [`ResponseWriter`](../../../src/services/http/ResponseWriter.ts) are independent; [`HttpServer`](../../../src/services/http/HttpServer.ts) selects `ExpressResponseWriter` concretely. | Preserve response factories; adapter selection supplies its writer.                                            |
| Server/global chain      | [`HttpServer`](../../../src/services/http/HttpServer.ts) constructs Express, uses `express.use`, and passes Express to `http.createServer`.                                                                                                          | Moving only the route runner is insufficient; adapter/listener ownership must also move.                       |
| Public types/extensions  | `FrameworkRequest extends express.Request`; [`BaseRequestContext`](../../../src/services/http/types.ts), error handlers and `transformResponse` inherit that surface.                                                                                | Give v2 handlers and their extension hooks a framework-owned context; keep legacy typing inside the bridge.    |
| Handler execution/errors | [`ControllerManager`](../../../src/controllers/index.ts) invokes `(req, res, next)` and normalizes errors inside its wrapper.                                                                                                                        | Give descriptor execution a portable path; let raw errors unwind wrappers before outer registry resolution.    |
| Parsing/global effects   | [`RequestParser`](../../../src/services/http/middleware/RequestParser.ts) uses Formidable on the Node request but wraps it in `res`/`next` and finish/close handling; CORS and logging also use response APIs/events.                                | Reuse parsing logic, move transport interaction to the adapter, and expose portable staged headers/completion. |

Parsing independence means Express is not required by the parsing algorithm; it does not mean
today's `RequestParser.middleware` already has a transport-neutral signature. Similarly, a new
writer must deliberately preserve or document changes to the serialization, ETag and conditional
response behavior currently delegated to Express. This is adapter conformance, not a reason to
redesign the router or require Rust.

### Smallest useful deliverable now

The shared pipeline should be callable with a framework context and return an `HttpResponse`,
without importing Express or writing to a socket. It composes middleware, validation and the
handler, then resolves an uncaught error after wrappers unwind. The adapter creates the context,
enters request ALS, runs response preparation and sends the result with its writer; completion is
reported separately. Preserve that context in deferred writer/completion callbacks as specified
below. Keep validation ordering unchanged during extraction.

An async middleware can `return next()` to delegate, return an `HttpResponse` to stop before later
middleware/handler execution, or throw. The adapter owns send state, transport events and any
legacy Express bridge. Global short-circuits, 404/405, parsing failures and handler errors must
still reach the shared response/completion path.

Demonstrate this with a conformance fixture that runs the portable pipeline against a plain
framework context and captures its returned response without Express. This proves the boundary
before a full Node adapter is required. Later adapter conformance must cover the same outcomes,
headers, streaming and disconnect behavior. Retain route-local `appInfo` inference and v5
subclass compatibility; a `Request` type alias that still extends Express is not the final boundary.

The proposed per-request `beforeSend` facility remains a separate lifecycle choice. Removing
Express requires preserved response preparation and completion behavior, not necessarily a new
public hook registry in the same patch. The existing `transformResponse` behavior must survive.

## Primary-source comparison

| Project                                                                                                                                                                | Relevant behavior                                                                                                                                                                                                                                     | Lesson for this decision                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [Koa](https://github.com/koajs/koa/blob/f2ec5f1607cda5dc87d0df6c435b386180b1b45e/lib/application.js)                                                                   | Composes middleware, enters request ALS, handles uncaught errors outside the chain, writes after the chain resolves.                                                                                                                                  | Ordinary onion already supplies lexical wrapping. It need not wait through streaming.                                        |
| [Hono](https://github.com/honojs/hono/blob/c91b60a251186fb024557c6d55a11d8e388f179c/src/compose.ts)                                                                    | Onion dispatch normally converts downstream `Error`s inside the chain. Its [context-storage middleware](https://github.com/honojs/hono/blob/c91b60a251186fb024557c6d55a11d8e388f179c/src/middleware/context-storage/index.ts) uses ALS around `next`. | Flow and error policy are independent decisions; do not infer rollback semantics from the word onion.                        |
| [AdonisJS](https://github.com/adonisjs/http-server/blob/0801ec2d7480a9610bd4063da24a82633fc2674a/src/server/main.ts)                                                   | Uses middleware wrapping, request ALS, tracing channels, and a separate response-completion notification.                                                                                                                                             | These facilities coexist without introducing a second business middleware API.                                               |
| [Fastify lifecycle](https://fastify.dev/docs/latest/Reference/Lifecycle/) and [request-context](https://github.com/fastify/fastify-request-context/blob/main/index.js) | Uses stages; its context plugin explicitly enters/restores ALS across continuations.                                                                                                                                                                  | Stages support ambient context and tracing. An arbitrary middleware-created scope does not automatically cover later stages. |
| [h3 current source](https://github.com/h3js/h3/blob/main/src/middleware.ts)                                                                                            | Supports optional `next`, auto-continues unhandled values, memoizes continuation results, precomposes chains.                                                                                                                                         | Optional continuation is feasible, but carries additional result/continuation rules. Boot composition is not exclusive to H. |
| [Ajv](https://ajv.js.org/guide/managing-schemas.html)                                                                                                                  | Compiles and reuses schema validators; recommends compilation outside request processing.                                                                                                                                                             | Establish a good precompiled JS control before attributing gains to a native implementation.                                 |

These are source/document observations, not comparative framework performance measurements.
Main-branch links may evolve; pinned links identify the reviewed snapshots where available.

## Proposed middleware contract

The following is a v2 target sketch, not an exported type in this commit:

```ts
type Next = () => Promise<HttpResponse>;
type Middleware = (
  ctx: RequestContext,
  next: Next,
) => HttpResponse | Promise<HttpResponse>;
```

- `return next()` delegates and propagates the response.
- `const response = await next(); ...; return response` performs response-construction work.
- Returning a branded `HttpResponse` without calling `next` short-circuits.
- Throwing rejects the continuation. Use `return await next()` inside `try/finally` when cleanup
  must wait for downstream settlement.
- `void`, a patch object, and a `Next` sentinel are not alternate continuation signals in this
  contract. Runtime failures must identify the offending middleware, rather than hang the request.
- `next` is single-use and expires when the invocation settles. Reject duplicate and late calls.
  A runner must account for already-started downstream work before selecting/writing a response
  after `next(); return otherResponse` or `next(); throw error`. A warning alone is insufficient.
  The production guard and cancellation policy need conformance tests; benchmark kernels do not
  claim to implement those guards.

Ordinary middleware keeps request-local data on the context:

```ts
async middleware(ctx, next) {
  ctx.appInfo.user = await resolveUser(ctx);
  return next();
}
```

An application-owned store needs no special scope registration:

```ts
async middleware(ctx, next) {
  const tenant = await resolveTenant(ctx);
  return tenantStorage.run(tenant, next);
}
```

Returning a patch can express data changes, but cannot itself establish an async execution scope.
General patch merging would also need deletion, collision, validation, and ownership rules. It is
not required to gain native optimization: built-in declarative operations can have internal
serializable plans while arbitrary application middleware remains ordinary JS.

The strict response target cannot silently pretend that legacy `res` handlers return descriptors.
During v5, the bridge needs an explicit internal completed/aborted/legacy outcome or an honest
bridge-specific return type. Full response inspection and transaction guarantees apply to the
descriptor path; writing directly to `res` cannot be rolled back by outer middleware. Settle this
bridge before publishing a v2 type that consumers are expected to keep unchanged in v6.

## API comparison for review: Auth, ALS and completion logging

These are alternative v2 API sketches with the same behavior, not runnable examples of today's
Express-based `AbstractMiddleware`. Framework imports and unchanged static metadata are omitted.
Keep Auth's `requiresAuth` and `provides` metadata so route-local user inference survives. In these
examples `RequestContext.appInfo.user` is optional until Auth succeeds; `GetUserByToken` populates
it first. Both models use the existing `HttpResponse` factories and error registry.

Shared types and application-owned storage:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

type ResponseResult = HttpResponse | Promise<HttpResponse>;
type Next = () => Promise<HttpResponse>;
type StepResult = void | HttpResponse | Promise<void | HttpResponse>;

type AuthenticatedContext = RequestContext & {
  appInfo: { user: AppUser };
};

// One storage instance per module; each invocation supplies its own value.
export const currentUser = new AsyncLocalStorage<AppUser>();
```

### Auth

Strict onion explicitly delegates after a successful check:

```ts
class Auth {
  middleware(ctx: RequestContext, next: Next): ResponseResult {
    if (!ctx.appInfo.user) {
      throw new UnauthorizedError({
        code: 'AUTH001',
        message: 'Please login to application',
        i18nKey: 'middleware.auth.notLoggedIn',
      });
    }

    return next();
  }
}
```

H continues after an ordinary step returns without a response:

```ts
class Auth {
  middleware(ctx: RequestContext): StepResult {
    if (!ctx.appInfo.user) {
      throw new UnauthorizedError({
        code: 'AUTH001',
        message: 'Please login to application',
        i18nKey: 'middleware.auth.notLoggedIn',
      });
    }
  }
}
```

Neither method needs `async` because the check does not await anything. If a middleware needs
async preparation, add `async` and await that work; the continuation rule remains the same.
Throwing stops downstream execution and unwinds wrappers before registry resolution. Alternatively,
both models can short-circuit by returning a descriptor:

```ts
return HttpResponse.json(403, { error: 'ACCESS_DENIED' });
```

No later middleware or handler runs on that path. The writer sends the response after preparation.

### Application-owned AsyncLocalStorage

Put UserScope after Auth. Strict onion uses the same method as ordinary middleware:

```ts
class UserScope {
  middleware(ctx: AuthenticatedContext, next: Next): ResponseResult {
    return currentUser.run(ctx.appInfo.user, next);
  }
}
```

H marks this as wrapping behavior with `around`:

```ts
class UserScope {
  around(ctx: AuthenticatedContext, next: Next): ResponseResult {
    return currentUser.run(ctx.appInfo.user, next);
  }
}
```

For H, a class has exactly one execution method: `middleware` or `around`; `around` uses the strict
continuation rules. The scope in both examples covers all later middleware, the handler and async
work created inside them. Deep services can read the current request's user after awaiting:

```ts
async function businessOperation() {
  await someAsyncOperation();
  const user = currentUser.getStore();
  // The user belonging to this request's scope.
}
```

There is no manual per-request `disable()` or store clearing. Separate async operations retain
their inherited context for their own lifetime. Deferred writer/completion callbacks do not
automatically inherit this middleware-owned scope; capture needed values explicitly or use the
documented context-binding policy. A resource lifetime, such as a database transaction, still
needs explicit cleanup and must not be assumed to last through lazy stream consumption.

### Logging after the response finishes

Both models use the same proposed completion callback. For these sketches its payload is
`{ outcome: 'finished' | 'aborted' | 'failed', status?: number, durationMs: number }`; the framework
measures the duration from request entry. Exact public naming remains reviewable. `ctx.logger`
denotes the proposed context logger with structured fields.

Strict onion:

```ts
class RequestLogger {
  middleware(ctx: RequestContext, next: Next): ResponseResult {
    ctx.onFinish(({ outcome, status, durationMs }) => {
      ctx.logger.info('HTTP request completed', {
        method: ctx.method,
        path: ctx.path,
        outcome,
        status,
        durationMs,
      });
    });

    return next();
  }
}
```

H:

```ts
class RequestLogger {
  middleware(ctx: RequestContext): StepResult {
    ctx.onFinish(({ outcome, status, durationMs }) => {
      ctx.logger.info('HTTP request completed', {
        method: ctx.method,
        path: ctx.path,
        outcome,
        status,
        durationMs,
      });
    });
  }
}
```

Register the callback before delegating, so an early failure or disconnect is observable. Put the
logger before Auth; for complete HTTP logging register it at request entry, before routing/parsing,
so it also covers 404s and parsing failures. Example route order after global setup:
`GetUserByToken → Auth → UserScope → handler`.

Code after `await next()` sees the returned descriptor, before the writer consumes a lazy body.
It therefore cannot replace `onFinish` for delivery logging. Completion is server-side finish,
abort or failure, not proof the client received the response. Never wait for completion inside
middleware that must first return the descriptor to start the writer.

### API trade-off and recommendation

| Concern                     | Strict onion                     | H                                  |
| --------------------------- | -------------------------------- | ---------------------------------- |
| Ordinary check              | Check, then `return next()`      | Check, then finish the method      |
| Async preparation           | Await work, then `return next()` | Await work, then finish the method |
| Application ALS             | `middleware(ctx, next)`          | `around(ctx, next)`                |
| Early response              | Return `HttpResponse`            | Return `HttpResponse`              |
| Delivery logging            | `ctx.onFinish`                   | `ctx.onFinish`                     |
| Execution contracts         | One                              | Ordinary step and wrapper          |
| Continuation misuse surface | Every middleware                 | Wrappers only                      |

**Author recommendation: strict onion.** The extra delegation line keeps one execution contract
when a simple middleware grows wrapping behavior. Explicit non-void return types help identify
forgotten returns; they do not replace runtime guards for duplicate/late continuation or
unawaited downstream work. H remains a valid alternative because ordinary steps do not control
continuation and can release async frames before a pending handler.

The matched experiment found H saved roughly 0.7 KB per pending request on Node with eight async
ordinary steps and two ALS wrappers; synchronous pass-through was essentially equal. These are
research-kernel results, not the cost of guarded production runners. See the full
[measurement limitations](#measurements-and-decision-gate).

For the Opus review, resolve these points before treating D2.1 as settled:

1. Does one public execution contract justify explicit continuation in Auth/Role/logger, given
   the measured but workload-dependent retention advantage and smaller misuse surface of H?
2. Can the v5 bridge honestly represent legacy direct writes without pretending every downstream
   result is an `HttpResponse`, while preserving existing subclasses?
3. Are single-use/late-next handling and unawaited-downstream accounting precise enough to prevent
   competing execution or writes, and what do those guards cost?
4. Are raw-error unwind, completion outcomes/context, and stream/resource ownership unambiguous?
5. Does the selected context and extension-hook surface remove Express types without introducing
   native infrastructure into the present migration?

## Errors, response hooks, transactions, and streams

Proposed normal ordering:

```text
request context / server trace
  -> middleware + validation + handler
  -> wrappers unwind (raw errors can be caught here)
  -> uncaught error registry resolution
  -> per-request beforeSend hooks
  -> existing global transformResponse
  -> writer
  -> exactly-once completion notification
```

`beforeSend` is the single per-request response-preparation hook, if adopted; do not add a second
`onResponse` alias with ambiguous timing. Already-registered hooks run newest first, including
normal short-circuits and registry error responses. A throwing hook is not retried: normalize its
error, then run the remaining hooks once. Freeze registration when preparation starts. The
existing global `transformResponse` retains P1q's policy: report a broken transform and use the
untransformed response.

A writer/serialization failure before headers commit is a separate recovery attempt. Do not
automatically replay application middleware or arbitrary hooks. Preserve request-wide staged
headers, normalize the write error, and use a bounded recovery path; completion observers report
the actual result. After commit, terminate/cancel as needed and report failure; another HTTP
response cannot replace bytes already sent. This intentionally limits any claim that a hook sees
every possible final transport outcome.

A returned 4xx response is a successful function return, not a thrown error. A transaction policy
that rolls back on certain response statuses must say so explicitly. Also, a transaction around
handler execution may commit before response hooks or serialization fail: this is not atomic
delivery of a database transaction and an HTTP response.

**Transaction retries are a separate hazard.** Mongoose's `connection.transaction` delegates to
`withTransaction`, whose callback may be retried. Consequently
`connection.transaction(() => next())` is not a generally safe recipe for a single-use request
chain. Replaying it could repeat nontransactional I/O and hook registration. Use an explicitly
single-execution transaction scope, or put retries inside an isolated, deliberately replayable
business operation. Retrying commit is distinct from rerunning the handler.
[Mongoose](https://mongoosejs.com/docs/transactions.html),
[MongoDB transaction APIs](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/).

A lazy response stream is consumed after the onion unwinds. It must not depend on a transaction
or lock already released by `finally`. Materialize transactional results first, or give the
stream its own explicit resource/cancellation lifetime. Replacing a response must dispose an
unused stream source; consuming/teeing a stream for caching is a separate capability.

`onFinish` means server-side completion, not client acknowledgement. Its proposed outcome is
`finished | aborted | failed`, with optional observed status/error and clearly defined duration
and byte counts. Register listeners early, settle exactly once across finish/close/error races,
and contain callback failures. An aborted transport does not magically cancel arbitrary JS or DB
work: expose an AbortSignal and require cooperative cancellation. End request-execution scopes
only after their work has unwound. Never await `onFinish` inside middleware that must first return
the descriptor to start the writer.
[Node ServerResponse semantics](https://nodejs.org/api/http.html#class-httpserverresponse).

## ALS and observable execution

Use one framework ALS instance, with a distinct context/store per request. It may reuse the
existing context rather than copy its body and state. An imported `requestContext()` accessor is
a convenience beside explicit `ctx`; it does not replace typed route-local `appInfo`.

Request context must be active across dispatch, error resolution, response preparation, writer
callbacks, and completion observers. An ordinary event listener does not automatically capture
its registration context. Specify whether a callback restores the framework request context or
the complete registration context, and test that choice. Prefer framework context by default;
capturing arbitrary registration scopes retains those scopes and is a measured, explicit cost.
Node's `AsyncLocalStorage.bind`/`snapshot` can support capture when needed.
[Node async context](https://nodejs.org/api/async_context.html).

Instrumentation must cover ingress/unmatched requests, dispatch, middleware, validation, handler,
registry resolution, response preparation, and transport outcomes. Reuse an existing HTTP SERVER
span when HTTP instrumentation owns it; do not create a duplicate server span. A handler span
ends on descriptor/error settlement; the server span ends on transport completion. Nested
middleware span duration includes downstream work and must not be presented as exclusive CPU
time for that middleware.

Use public OTel context APIs (`context.with`, `context.bind`, `startActiveSpan`) in the integration.
Creating a span without activating it does not establish parentage. Do not depend on an OTel
context manager's private ALS field. Framework tracing channels may be the integration mechanism,
but are not an application transaction API. `tracePromise` settlement is not stream completion;
the writer/completion seam supplies that event. Node 24 and Bun need their own conformance tests
for the chosen channel/context APIs. A trace exporter must not control business continuation.
[OTel context](https://opentelemetry.io/docs/languages/js/context/),
[OTel instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/),
[Fastify tracing channels](https://fastify.dev/docs/latest/Reference/Hooks/#diagnostics-channel-hooks).

## One architecture for JS and native capabilities

**Future design constraints only:** none of the native mechanisms in this section need to be
implemented, exported or selected before the portable middleware contract and Express cutover.

The intended model is **one application declaration, interchangeable execution backends**. The
application describes its routes and schemas in JS/TS. Boot builds a route/schema plan; a Rust
validator can execute the supported validation plan. Separately, a middleware author can provide
a Rust implementation alongside the JS implementation, and deployment policy can select it.
Neither change requires consumers to rewrite their routes or middleware usage.

```mermaid
flowchart TD
    Declarations["TS routes, schemas, paired middleware implementations"] --> Boot["Boot: normalize and select supported implementations"]
    Boot --> Plan["Ordered execution plan"]
    Transport["Express / Node / future Rust transport"] --> Context["Portable context + trace entry"]
    Context --> Executor["JS orchestration: middleware, errors, hooks"]
    Plan --> Executor
    Executor --> JS["JS handlers and selected JS implementations"]
    Executor --> Native["Rust JSON Schema validator / paired Rust middleware"]
    JS --> Response["HttpResponse + response preparation"]
    Native --> Response
    Response --> Writer["Adapter writer: backpressure, cancellation, completion"]
```

The diagram is a logical contract, not a promise that each box allocates an object. Native
operations are called at their ordered positions; they do not all run after JS middleware. A
native transport owns the beginning of ingress telemetry before control first enters JS.

Keep three boundaries independent:

1. **Authoring:** portable context, immutable response descriptors, explicit continuation, schema
   validation, lifecycle hooks. Application code remains JS/TS.
2. **Execution plan:** route identifiers, ordered middleware capabilities and configuration,
   schema plans, implementation IDs and fallback decisions, prepared at boot. An explicitly
   registered Rust peer supplies native eligibility for a middleware; it is not limited to
   framework built-ins.
3. **Transport/native ABI:** a small versioned representation of supported data, operation IDs,
   outcomes, cancellation and ownership. A TypeScript interface alone is not a wire/FFI contract.

| Candidate                                 | Plausible native boundary                               | Conditions                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| HTTP parsing/listening and route matching | Transport adapter and compiled route table              | Preserve matching/decoding, limits, cancellation, routing metadata and fallback behavior.                             |
| Validation                                | Reusable compiled validator capability                  | Exact supported semantics, transformed output and issue contract; otherwise original JS validator.                    |
| Known stateless header/policy operations  | Declared operation + serializable configuration         | Same ordered position, same failure/hooks/telemetry behavior; no hidden JS closures.                                  |
| Rate limiting or caches                   | Driver/backend operation                                | Preserve store ownership, distributed semantics and fallback; a faster local map is not equivalent to a shared store. |
| Application middleware with a Rust peer   | Versioned operation contract and paired implementations | Preserve its complete behavior, including external stores and response effects; select one implementation at boot.    |
| Response serialization                    | Writer/serializer capability                            | Status/body restrictions, headers/cookies, errors and stream behavior remain identical.                               |

### Paired middleware implementations

A middleware capability owns its configuration schema, versioned inputs/outputs, permitted
context changes, errors and response behavior. It can ship a reference JS implementation, an
optional hand-written Rust implementation and shared conformance fixtures. Applications register
that capability once; the framework resolves its backend at boot. A production policy may prefer
Rust when the binary and capability version are supported. Development and CI must also be able
to select either backend so behavior differences are found before production. Expose the chosen
backend and any fallback reason in boot diagnostics; do not branch on the environment on every
request.

The public middleware contract and the native call ABI have different jobs. A JS adapter can call
the selected operation, apply its declared context changes and then call `next()`, or return its
response descriptor. The native result can internally encode continue/response/failure; this does
not introduce alternate continuation signals into the public onion API. Marshal only the fields
that operation needs, and reuse its compiled configuration across requests.

A Rust peer for a true wrapping middleware additionally needs a continuation bridge: invoke the
JS suffix in its request context, await its response/error, then finish the native scope. That
bridge must preserve single-use continuation and ALS/trace/error semantics. It is an optional
capability with its own measured cost, not a requirement imposed on a schema validator or a simple
request-stage operation. The distinction can stay inside the implementation adapter; it does not
force two public middleware APIs.

**Middleware selects an outcome; the response writer sends it.** A middleware may short-circuit
by returning a response descriptor, but a native peer must not write directly to a socket and
bypass remaining response hooks or completion telemetry. This keeps JS and Rust implementations
under the same response contract. Raw socket routes remain an explicitly separate facility.

Choose fallback before the operation starts. An error after a native implementation has performed
side effects is an operation failure, not permission to rerun the JS implementation. A pure schema
validator has a simpler boundary, but its fallback still needs an explicit policy.

Initially, keep JS orchestration authoritative and call selected native operations. Later, fuse
contiguous eligible native operations only after proving that no observable operation is moved.
An auth-before-validation route must not start returning validation errors before auth. Native
early rejection must still honor registry overrides, response transforms, staged headers and
telemetry; if these require JS, return a structured outcome to JS rather than bypassing them.

The native engine spike currently explores validate-before-JS rejection and leaves middleware in
JS. Extending it to native policy segments or changing observable ordering requires a separate
approved plan. This proposal reserves a compatible seam; it does not silently extend that spike.

At a Node-API boundary, JS values belong to the JS environment/thread. Rust workers exchange owned
data and schedule JS callbacks through supported mechanisms; do not retain borrowed JS values on
arbitrary threads. Bound callback/context restoration must be per request, not a process-wide ALS
store on a shared native callback. Across processes/threads, propagate trace context explicitly;
ALS itself is not transferable. Measure callback queues, copies, parses and backpressure as part
of the request cost. [NAPI-RS ThreadsafeFunction](https://napi.rs/docs/concepts/threadsafe-function).

## Route validation through JSON Schema

The first native candidate should be the route's **validation operation**. A practical pipeline is:

```text
JS/TS route + Zod/Yup schema
  -> boot-time vendor converter / Standard JSON Schema interface where supported
  -> supported JSON Schema + explicit input/output normalization policy
  -> reusable Rust validator selected for that route
  -> framework validated value or validation issues
```

For the supported JSON Schema subset, Rust can perform the check without calling the schema
library on each request. The route declaration and inferred handler types remain in JS/TS. This
can first run behind the existing JS transport; a future Rust HTTP adapter can reuse the same
route/schema plan. A validator's performance gate does not depend on replacing the whole server.
The relevant question is whether the exported plan preserves that route's validation contract,
not whether its schema library was written in JavaScript.

The ecosystem now has two relevant, orthogonal specifications:

- **Standard Schema** describes a validation function returning a value or issues, synchronously
  or asynchronously.
- **Standard JSON Schema** describes input/output JSON Schema converters and target dialects.

The second specification corrects the older statement in the engine spike that there is no
standardized export interface. It does not imply that a converter preserves all runtime behavior.
[Specifications](https://standardschema.dev/), [Standard JSON Schema](https://standardschema.dev/json-schema).

The current framework's `StandardSchemaDriver.toJsonSchema` is explicitly an **OpenAPI exporter**.
For Zod it selects input shape, allows `unrepresentable: 'any'`, and documents coerced dates using
an HTTP convention. `defineSchema` can also associate supplied documentation with arbitrary
validation code. Neither result is sufficient authorization to replace runtime validation.
Zod documents both unrepresentable constructs and different input/output schemas.
[Zod conversion](https://zod.dev/json-schema).

A future optional schema-plan builder must return either a verified supported plan or an explicit
unsupported reason. Selection happens at boot; unknown capability means JS fallback, never
weaker validation. Maintain the existing `validate` contract as the semantic authority. Keep the
native compilation seam separate from `toJsonSchema` so improving documentation cannot silently
change request acceptance.

Differential conformance includes acceptance/rejection **and** output values, stripped fields,
defaults, coercion order, transforms/refinements, issue paths/order/messages/codes, i18n, numeric
precision, Unicode/regex/format semantics, unions, references, and async failure behavior. Missing
features cannot be ignored. An initial opt-in JSON-only subset with no transformations is a
reasonable research target; it still needs an explicit dialect and format policy. Rust already
has reusable JSON Schema validators, but their supported keywords and format defaults must be
checked. [Rust jsonschema](https://docs.rs/jsonschema/latest/jsonschema/).

## Measurements and decision gate

The old `retained-memory.mjs` B model is an auto-continuing hybrid, not strict onion. C2W's timing
case uses response callbacks, while H's uses suspended wrappers; its ALS scope also starts at the
handler rather than covering later middleware. These are useful implementation measurements, not
proof of equal semantics at lower cost. The old CPU benchmark does contain strict onion.

The companion [strict comparison](middleware-experiments/strict-comparison.mjs) adds an explicit
onion/H comparison with shared assertions and recorded limitations. The
[raw results](middleware-experiments/strict-comparison-results.json) record Node 26.12.1 on macOS
arm64, ten middleware (eight ordinary steps and two independent suffix ALS wrappers), two identical
response hooks, 10,000 pending requests, and five fresh processes per cell. Medians below are
additional retained `heapUsed` beyond preallocated contexts/gates/holding arrays; they include the
common pending-handler harness and are not total request memory.

| Pending-handler workload                                    |    Strict onion |               H |
| ----------------------------------------------------------- | --------------: | --------------: |
| Synchronous steps; wrappers return `store.run(value, next)` | 2,226 B/request | 2,225 B/request |
| Async prework; same wrappers                                | 3,361 B/request | 2,602 B/request |
| Synchronous steps; wrappers await downstream with `finally` | 3,819 B/request | 3,707 B/request |
| Async prework; wrappers await downstream with `finally`     | 4,770 B/request | 4,084 B/request |

The practical correction is that **ordinary synchronous `return next()` need not retain an async
frame per middleware**. H saves about 759 B/request or 686 B/request in the two async-prework cases
(about 7.6 MB or 6.9 MB at 10,000 pending requests). That is a real advantage in this experiment,
but does not establish a universal twofold improvement or justify a second public contract by
itself. Async prework here is an already-resolved-promise boundary, not database I/O.

When the descriptor has returned and wrappers/hooks have unwound, all strict/H cases retain about
618–621 B/request in the synthetic writer phase. The handler-only baselines are 1,288 B pending
inside the handler and 432 B pending inside the writer. Context/gate/array setup adds roughly
368–385 B/request separately. Baselines omit middleware ALS and hooks, so their subtraction
includes these features as well as dispatch overhead. The JSON retains individual samples/ranges;
these ranges are not confidence intervals.

Conformance passes 32 cases with 40 concurrent requests per pending case, checking suffix ALS,
isolation, early responses, raw-error unwind, and cleanup before writing. Both kernels omit
production continuation-misuse guards, cancellation, full hook/error policies and instrumentation.
The synthetic writer holds a descriptor after unwind; it measures no HTTP sockets, real streams,
backpressure or throughput. These results strengthen the case for trying strict onion first;
Sol's preference for H remains worth revisiting against actual guarded runners and async workloads.

The synchronous pass-through result depends on preserving promise delegation. Production expiry,
result validation and unawaited-downstream accounting may add reactions or retained state; these
kernels therefore do not establish the guarded contract's memory cost.

Choose the public contract after measuring the actual guarded runners with representative counts
of synchronous guards, async prework, wrappers, hooks and enabled instrumentation. Include retained
heap, RSS/external memory, allocation/GC pressure, CPU per request, throughput and p95/p99. Report
Node and Bun separately. Add real HTTP slow-client streams and disconnects; measure the native
crossing against the JS work it replaces. Do not declare a winner from a toy ns/op delta.

The existing transport spike remains authoritative: establish Express and Node controls, then the
native-core comparison, and build a Rust HTTP engine only when its rung gates pass. Preserve its
realistic workload thresholds. A Rust validator or paired middleware can instead be evaluated
behind the current transport, with its own equivalence/performance gate and an optimized JS
control. This proposal claims no Rust speedup and does not make HTTP/2 a Rust-only benefit.

## Delivery path and acceptance

1. Review D2.1 with the relaxed `next` requirement, strict onion/H evidence, and Sol's dissent.
   Decide the bridge outcome, context representation and scope/error/completion semantics before
   implementation. Keep this document proposed until the owner chooses.
2. Complete the P1q/P1m portable contract: framework-owned context and extension-hook types, the
   selected response-returning runner, raw-error unwind, ALS and completion boundaries. Connect it
   to the existing Express writer. Update P1m's files list before implementation; keep the v5 bridge
   and inherited signatures compatible. Verify the shared pipeline independently of Express.
3. Continue the [Node adapter](../later/node-adapter.md), [default adapter](../later/default-node-adapter.md)
   and [Express removal](../later/drop-express.md) work: migrate listener/global middleware ownership,
   provide the replacement writer, cut over legacy controller/middleware signatures and remove
   transitive Express types/dependencies. Preserve route declarations and returned-response APIs.
   Reconcile the older cards' release-cadence assumptions with the owner's target before shipping;
   this research document does not silently reschedule their releases.
4. Optional later work: measure Rust JSON Schema validation or a paired middleware implementation
   behind the same contracts. A Rust HTTP engine follows the separate transport spike. Native
   experiments, backend manifests and operation fusion are not prerequisites for steps 1–3.

Current middleware conformance: nested/async ALS and spans; early responses; thrown primitive and
Error values; registry and adopted-hook failures; duplicate/late/unawaited continuation; callback
retries; legacy direct response; finish/error/close races; concurrent disconnect; stream replacement
and resource cleanup; lazy stream context; global/error paths and typed request-context portability.
Include optional tracing integration using public APIs, with concurrent isolation, span parentage
and log correlation. An exporter must not become a requirement for dispatch.

Future native conformance, only when implemented: validator parity; paired implementation parity;
mixed native/JS ordering; native early responses honoring registry/transform behavior; and fallback
that neither repeats a side effect nor exposes rejected data.

**Out of scope for this research change:** runtime implementation, native infrastructure, changing
schema acceptance, or migrating application code. The present implementation objective remains
portable middleware and Express removal; future backends must fit it.
No client-specific examples, data, paths or identifiers are included.

## Verification record

The original research revision was verified in an isolated checkout of the baseline on Node
26.12.1; production source files are
unchanged. Research conformance and heap measurements are separate from production guarantees.

| Check                                                                                                                 | Result                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                                                            | Passed: 1,022 tests, 250 suites, zero failures or skips. Used cached MongoDB 8.2.6 via `MONGOMS_SYSTEM_BINARY` and `MONGOMS_VERSION=8.2.6`. |
| `npm run check`                                                                                                       | Passed after formatting the new proposal.                                                                                                   |
| `npm run check:types -- --checkers 1 --incremental --tsBuildInfoFile node_modules/.cache/tsc/framework.tsbuildinfo`   | Passed, including code generation.                                                                                                          |
| `npm run check:types:tests -- --checkers 1 --incremental --tsBuildInfoFile node_modules/.cache/tsc/tests.tsbuildinfo` | Passed, run after the main type check.                                                                                                      |
| `npm run smoke`                                                                                                       | Passed: build, pack, install and checks in a scratch consumer.                                                                              |
| Strict/H harness                                                                                                      | 32 conformance cases passed; hook counts 0, 1 and 2 checked. Measurement: 90 fresh workers, five samples per cell.                          |

No Bun, real HTTP load, native implementation or production v2 middleware runner was benchmarked
in this change. Those checks remain part of the proposed implementation/decision gates.

The subsequent owner clarification changes documentation only. Its checks are `npm run check`
and `git diff --check`; the runtime checks above belong to the original research revision.
