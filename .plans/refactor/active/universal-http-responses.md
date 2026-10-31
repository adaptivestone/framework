# P1q — Universal typed HTTP responses (v5.x bridge → v6 cutover)

**Status**: 🔄 active · Phases 0–1 implemented 2026-10-31 (unreleased), Phase 2 next · design direction settled 2026-07-18 · `transformResponse` hook folded in 2026-08-10  
**Target**: the next minor (5.7; 5.6.0 shipped without it), additive; ordinary controller `res` removal is v6
**Depends on**: [tree-router](../done/tree-router.md) ✅, [error-handler-registry](../done/error-handler-registry.md) ✅  
**Feeds**: [OpenAPI responses](../queued/openapi-responses.md), [async middleware](../queued/async-middleware.md) — **co-designed: P1m's v2 middleware contract (opt-in `static contractVersion = 2`) ships in the same v5.6 minor and returns `HttpResponse` through this plan's writer** —, [NodeAdapter](../later/node-adapter.md), eventual [drop Express](../later/drop-express.md)  
**Origin**: an authorized file-delivery workaround exposed the immediate stream/file gap. The wider design discussion showed that a file-only helper would preserve the real problem: controllers would still use Express for JSON, statuses, headers, redirects, and errors.

## Goal

Introduce one framework-owned, typed response value for JSON, text, bytes, streams, files,
redirects, empty bodies, and standard Web responses. In v5.3 it is rendered by Express and
coexists with today's `(req, res, next)` handlers. In v6 ordinary controllers stop receiving
`res`; replacing Express later becomes an adapter change rather than a consumer rewrite.

```text
controller return ─┐
                   ├─> HttpResponse ─> ResponseWriter ─> Express (v5.3)
thrown error ──────┘                                  └> Node/Fetch (later)
```

## Settled decisions

1. **One response algebra, not a `FileResponse` special case.** File delivery is a specialized
   variant because it needs length/range/ETag/disposition metadata, but it uses the same writer
   boundary as JSON and every other response.
2. **Handlers return branded framework descriptors.** Descriptors are immutable data, not an
   Express wrapper and not a subclass of Web `Response`. Factories preserve literal status,
   media type, and body type for TypeScript/codegen.
3. **Thrown errors stay.** Controllers continue throwing `HttpError` subclasses or errors handled
   by `registerErrorHandler`. Error resolution normalizes to the same `HttpResponse` boundary;
   handlers do not need `JsonResponse<404, ...>` unions for every failure.
4. **v5.3 supports both styles.** Only a branded `HttpResponse` return activates the writer.
   Existing `res.status().json()`, streaming, and third-party Express handlers keep working.
   Mixing both styles in one invocation is an error.
5. **v6 removes `res` from ordinary controllers and registry middleware.** Raw transport access is
   explicit and adapter-specific, never an optional parameter on every handler.
6. **Web standards are the portability boundary, not the authoring contract.** A native Web
   `Response` may be returned through `HttpResponse.native()`, but using it directly would erase
   the typed body/status information needed by OpenAPI and generated clients.
7. **OpenAPI is assembled from the whole route pipeline.** Handler returns describe normal
   outcomes; validation, middleware, and registered error metadata contribute their own statuses.
   AST scanning of `throw` expressions is explicitly rejected because errors can originate in
   arbitrarily deep service calls.

## Proposed public API

Names are intentionally distinct from Express's `Response` and the Web `Response` global.
Status is always the first argument: overloads where a numeric JSON body could be mistaken for a
status are not allowed.

```ts
import {
  HttpResponse,
  type EmptyResponse,
  type JsonResponse,
} from '@adaptivestone/framework/services/http/responses.js';

async create(req: CreateUserRequest): Promise<JsonResponse<201, UserDto>> {
  const user = await this.app.getModel('User').create(req.appInfo.request);
  return HttpResponse.json(201, user);
}

async remove(req: DeleteUserRequest): Promise<EmptyResponse<204>> {
  await removeUser(req.params.id);
  return HttpResponse.empty(204);
}
```

Initial factory family:

```ts
HttpResponse.json(status, body, options?);
HttpResponse.text(status, body, options?);
HttpResponse.bytes(status, body, options?);       // Uint8Array
HttpResponse.stream(status, source, options?);    // Web stream or async byte iterable
HttpResponse.file(status, delivery, options?);    // range-capable storage/file source
HttpResponse.redirect(status, location, options?);
HttpResponse.empty(status, options?);
HttpResponse.native(webResponse);                 // portable escape hatch
```

All options use Web `Headers`/`HeadersInit` semantics. The canonical streaming input is
`ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>`; Node `Readable` already participates as
an async iterable without making the descriptor depend on Express.

### Status/body rules

- `204`, `205`, and `304` are accepted only by `empty`.
- Redirect helpers accept `301`, `302`, `303`, `307`, or `308` and own the `Location` header.
- `206` file responses require range metadata; ordinary streams do not pretend to be seekable.
- `HEAD` reuses the matching GET representation metadata while the writer suppresses the body.
- `101` upgrade and informational responses such as `103` are transport capabilities, not final
  `HttpResponse` values.
- SSE is a later specialized stream helper (`HttpResponse.sse`) so its abort/framing rules are not
  hidden inside the generic byte-stream API.

## v5.3 compatibility contract

The controller wrapper distinguishes new responses by a private/unique brand, not duck typing:

```ts
const result = await original(req, res, next);

if (HttpResponse.is(result)) {
  if (res.headersSent) {
    throw new FrameworkError(
      'Handler mutated res and returned an HttpResponse in the same invocation',
    );
  }
  return responseWriter.write(result, req, res);
}

// Any other result is legacy v5 behavior. Express may already have sent it.
return result;
```

This is additive even for handlers returning the value of `res.json(...)` (an Express response,
not a branded descriptor). New handlers should omit `res` from their own method signature even
though the v5 router still supplies it at runtime.

Framework-produced 400/405/415/500 responses and built-in controllers migrate first. That makes
the writer a real framework boundary before consumers opt in, while retaining the existing
`headersSent`/client-abort safety path for legacy streams.

## Errors remain throwable

Recommended controller style:

```ts
async get(req: GetUserRequest): Promise<JsonResponse<200, UserDto>> {
  const user = await findUser(req.params.id);
  if (!user) throw new NotFoundError({ code: 'USER_NOT_FOUND', i18nKey: 'user.notFound', message: 'User not found' });
  return HttpResponse.json(200, user);
}
```

`registerErrorHandler` remains source-compatible. Its existing `{ status, body }` result is
normalized to `HttpResponse.json(status, body)` internally; a handler may additionally return an
`HttpResponse` directly when it needs non-default headers/content. The registry's log level and
first-match/null-fallthrough semantics do not change.

## Response transform hook (`transformResponse`)

**Origin**: wishlist #17 (2026-08-09, consumer envelope adoption on 5.3.3). A project whose wire
convention is `{ data, message?, errors? }` cannot today wrap framework-emitted bodies (validation
400, the 404 page, platform 500) without monkey-patching Express `res.json` from `bootHttp` — which
couples the project to the exact dependency this plan removes. Changing the framework's own wire
shape was declined (the framework emits `data` in exactly one response; the envelope is the
project's convention), and per-error-class `registerErrorHandler` can never cover success bodies.
The right altitude is a project-level whole-response transform, specified here so it is born
adapter-neutral and ships with the writer instead of being built twice.

- **Contract**: `transformResponse(response, { req }) => HttpResponse` — synchronous, operates on
  the branded descriptor, never on adapter objects. Projects match on kind: reshape `json`
  descriptors, pass `stream`/`file`/`redirect`/`empty` through untouched. **Registration settled
  2026-10-31 (user): a `Server` option beside `bootHttp`** (`new Server({ …, transformResponse })`),
  one per app by construction and passed to tests by `configureTestServer`; not an `HttpServer`
  method.
- **Guarantee**: every response the framework renders passes through the hook — validation 400s,
  the 404 page, the error sink, error-registry results, built-in controllers. This becomes true at
  Phase 2 (framework responses traverse the writer); the hook must not be advertised before then,
  or it silently covers only descriptor-returning handlers.
- **Bridge period (v5.x)**: legacy handlers that call `res.json` directly never reach the writer.
  If the all-JSON guarantee is wanted before v6, the Express-era implementation is a `res.json`
  wrap owned internally by `ExpressAdapter`, with `ExpressResponseWriter` sending through the same
  point so the hook applies exactly once; consumers never see Express. In v6 the writer is the
  only path and the implementation moves there — the consumer contract does not change.
- **Failure**: a throwing transform logs at `error` and renders the original response — a broken
  envelope must not take the API down.
- **OpenAPI caveat**: a transform makes generated body schemas wrong unless paired with a
  declarative schema wrapper in Phase 3; until that exists, the docs must state that the export
  describes untransformed bodies.
- **Why not standalone/earlier**: before the writer exists the hook could only be body-based
  (`(body, status) => body`), a public contract Phase 1 would immediately break. Specifying it
  inside this plan gives it the descriptor signature from birth.

## Raw response access

### v5.3

The legacy `(req, res, next)` signature remains the raw Express escape hatch. It is needed for
existing third-party Express integrations and gives consumers one release line to migrate.

### v6

Ordinary controllers and registry middleware receive framework context only and return
`HttpResponse | void`. There is no optional `res` parameter. Two explicit escape levels remain:

1. `HttpResponse.native(webResponse)` for portable fetch/proxy pass-through.
2. A separately declared raw-transport route/controller for WebSocket upgrade, `CONNECT`, direct
   socket ownership, or adapter-specific third-party integration. Its exact v6 API is deferred,
   but it must be opt-in, advertise the required adapter, bypass automatic response rendering,
   and receive limited/no automatic OpenAPI output.

Cookies, headers, redirects, files/ranges, SSE, ordinary streaming, trailers, early hints, and
client-abort handling are **not** reasons for ordinary raw access; they belong in framework
responses or adapter capabilities.

## OpenAPI and AST contract

The response algebra gives the AST extractor a stable outer grammar:

```ts
Promise<
  | JsonResponse<200, UserDto>
  | JsonResponse<202, JobAccepted>
  | EmptyResponse<304>
>;
```

The syntactic OXC pass can reliably extract response kind, literal status, media type, and the
referenced body type expression. It **cannot by itself** turn arbitrary imported/generic
TypeScript (`Pick`, conditional types, intersections, etc.) into JSON Schema; the current AST
architecture deliberately has no semantic type checker.

Type-first extraction therefore requires an explicit handler return annotation. OXC does not try
to infer the type of `return HttpResponse.json(200, value)` from local control flow. Handlers that
prefer inferred TypeScript returns use the route `responses:` contract for OpenAPI instead.

Therefore v5.3 uses this precedence:

1. A route `responses:` Standard-Schema map, when supplied, is authoritative for body JSON Schema
   and can also power optional future response validation/serialization.
2. Built-in framework responses and non-JSON variants have known schemas (`binary`, text, empty,
   redirects, standard error envelopes).
3. Explicit response return types contribute status/media type and generated TypeScript client
   information. A semantic type-to-JSON-Schema resolver may enrich the body after a separate
   feasibility spike; syntax-only code must never invent a schema.
4. Unresolved body types produce a targeted OpenAPI warning and keep the correct status/media type
   with an explicitly undocumented body.

The generator merges handler outcomes with route-structural responses: validation `400`, content
type `415`, middleware-declared `401/403/429`, registered documented errors, and the framework's
unhandled `500`. The old unconditional `200/400/401/404` stub set is removed.

## Delivery phases

### Phase 0 — contract tests and API spike ✅ 2026-10-31

- Lock factory names, status restrictions, descriptor branding, header semantics, and public
  exports in type/runtime tests.
- Settle the `transformResponse` registration point (`Server` option vs `HttpServer` method) and
  its exact signature.
- Prove Web stream and async-iterable writing through Express with abort propagation.
- Measure the semantic type-resolution options for OpenAPI; do not block the runtime layer on it.
  **Deferred to the start of Phase 3** (it does not block Phases 1–2).

Settled (locked by `responses.test.ts`, `ExpressResponseWriter.test.ts`, `ExpressAdapter.test.ts`):

- **Module/export layout.** `services/http/responses.ts` (public; reached through the existing
  `./services/*` export, so no `package.json` change), `ResponseWriter.ts` (adapter interface),
  `ExpressResponseWriter.ts`. `HttpServer.responseWriter` is the shared writer instance.
- **Factories**: `json`, `text`, `bytes`, `stream`, `redirect`, `empty`, `native`, plus
  `HttpResponse.is`. `file` is **not** added until Phase 4 settles its delivery shape (no stub).
- **Branding.** `Symbol.for('@adaptivestone/framework/HttpResponse')`: a registered symbol, so two
  installed framework copies recognize each other's descriptors; a look-alike object without it
  stays legacy. Descriptors and their header pairs are frozen.
- **Status rules.** Literal statuses fail to compile and every status is checked at runtime
  (`RangeError`): 200–599 only; 204/205/304 only via `empty`; 206 nowhere until file responses;
  `redirect` takes literal 301/302/303/307/308. A runtime `number` compiles for body/empty kinds.
- **Media type** is `options.contentType` and kept as a literal type parameter (`JsonResponse<S,
  B, M = 'application/json'>`); a `content-type` header in `headers` is rejected, as is `location`
  on `redirect`. `json(status, undefined)` is rejected (use `empty`).
- **Headers** go through Web `Headers` (validation, lower-case names, repeated names combined,
  one entry per `set-cookie`) and are stored as `ResponseHeaders` pairs, which are themselves a
  valid `headers` init. Writing: a descriptor header replaces a same-name header set earlier
  (security headers, CORS), `set-cookie` is appended, `vary` merged.
- **Express rendering.** JSON/text/bytes go through `res.json`/`res.send`, so ETag, conditional
  GET, charset and `json spaces/replacer` match legacy output; `redirect` uses `res.redirect`.
  A write that fails before headers are sent (`JSON.stringify` throws, a bad first chunk)
  restores the status, status text and headers it found, so the error response carries none of
  the descriptor's (`set-cookie`, `location`, …).
- **Streams.** A `ReadableStream` is read through its reader; any other source through its async
  iterator. Status and headers are committed with the first chunk: an error before it rejects
  with `res` untouched (→ error registry / 500), an error after it destroys the response and
  rejects, a client disconnect calls `return()`/`reader.cancel()` and resolves. HEAD cancels the
  source unread. Verified on Node 26.12.1 and Bun 1.4.4.
- **Native.** Status, status text, headers (hop-by-hop framing headers dropped) and body. A
  `fetch()` response keeps the upstream `content-encoding`/`content-length` although its body was
  decoded: documented, not rewritten.
- **`transformResponse`**: `Server` option, `(response, { req }) => HttpResponse` (see above);
  built in Phase 2.

### Phase 1 — additive runtime boundary ✅ 2026-10-31

- Add `HttpResponse` types/factories, `ResponseWriter`, and `ExpressResponseWriter`.
- Teach controller dispatch to render branded returns and reject mixed legacy/new responses.
- Preserve every legacy return path byte-for-byte.

As built: rendering lives in `ExpressAdapter` dispatch (not the controller validation wrapper), so
controller handlers and ad-hoc `registerRoute` handlers both get it. A handler that already sent
headers and returns a descriptor raises an error to `next(err)` (the final sink logs it at
`error`); headers set without sending are merged, because global middleware sets them. Writer
failures go to `next(err)` and resolve through the error registry. Verification: the new tests
pass on Node and Bun locally; Biome, both type checks and the packaging smoke test pass. The full
suite needs MongoDB, which this session's network policy blocked (`fastdl.mongodb.org`), so it
runs in CI. Docs (docs repo) are not written yet; they follow Phase 2.

### Phase 2 — framework and error migration (implemented 2026-10-31, except `Auth`)

- Route framework-generated responses and error-registry results through the writer.
- Migrate `Home`/`Auth` framework controllers to returned descriptors as fixtures for consumers.
- Keep legacy `{ status, body }` error-handler results accepted.
- Expose and document `transformResponse` here — the all-responses guarantee only holds once
  framework responses traverse the writer.

As built:

- **Writer is the single seam.** The controller validation wrapper _returns_ its 415, 400 and
  error responses (the adapter writes them); the adapter writes its malformed-URL 400 and 405;
  `add404Page` and the final sink write through `HttpServer.responseWriter`. This is also the P1s
  metrics hook point: one `write()` sees every framework-rendered response.
- **Error registry.** `ErrorHandlerFn` may return an `HttpResponse`. A `{ status, body, headers }`
  result becomes `errorResultResponse()`: JSON, a `Content-Type` header kept as the media type,
  `empty` for an undefined body or 204/205/304. `resolveError` returns `ResolvedError` = the
  legacy fields plus `response` (additive). A result that is not a valid response (e.g. status 99)
  counts as a broken handler → logged, 500. If the error response itself cannot be written (a
  circular body), the sink falls back to the plain 500 without writer or transform.
- **`transformResponse`**: `Server` option → `HttpServer` constructor option → the writer. It
  covers returned responses, validation/415/405/404/malformed-URL, registry results and the
  500; a handler writing `res` itself bypasses it. Throwing, returning a non-response or a
  Promise → logged at `error` through `HttpServer`'s logger, original sent.
- **RequestParser** 413/400 → `next(new HttpError(...))` with the same translated message, so
  they reach the registry and the transform; `Connection: close` stays on `res`. No error codes
  were added (bodies unchanged).
- **Built-ins.** `Home` and `Health` return descriptors, keeping an optional `res` parameter and
  `| Response` in their return types so overrides written against `res` still compile (pinned
  by compile-only subclasses in `Home.test.ts`/`Health.test.ts`).
- **Held: `Auth`.** Migrating it would silently drop the response of an override that does
  `await super.postLogin(req, res)` without returning — a runtime break for the most-subclassed
  controller. Flagged to the user 2026-10-31 instead of shipping; candidate for the v6 bucket.
- **Not routed (yet):** the CORS preflight 204 (global middleware writes `Content-Length: 0`
  itself; a transform would pass an empty response through unchanged anyway) and `RateLimiter`'s
  "not initialised" 500 (registry middleware — moves with P1m). The optional `res.json` bridge
  that would extend the transform to legacy handlers before v6 was not built; open question.

### Phase 3 — OpenAPI/type integration

- Extend AST extraction with explicit response return types and imports.
- Add optional `responses:` route contracts and thread them through `RouteRegistry`.
- Merge returned, structural, middleware, and registered-error responses in OpenAPI.
- Replace generic response stubs; generate body schemas only from trustworthy sources.

### Phase 4 — production file/stream semantics

- Add storage delivery (`stream` or signed redirect), `HEAD`, ranges, `Content-Length`, ETag,
  last-modified/cache/disposition handling, abort cleanup, and post-header error logging.
- Validate against representative local and object-storage drivers; the controller must not import
  `node:fs`, `node:stream`, or touch Express `res`.

## Expected files

- New: `src/services/http/responses.ts`, `src/services/http/ResponseWriter.ts`,
  `src/services/http/ExpressResponseWriter.ts` and colocated tests.
- Runtime: `src/controllers/index.ts`, `src/services/http/routing/ExpressAdapter.ts`,
  `src/services/http/HttpServer.ts`, `src/services/http/builtinErrorHandlers.ts`,
  `src/services/http/routing/RouteNode.ts`, `src/modules/AbstractController.ts` and tests.
- Built-ins: `src/controllers/Home.ts`, `src/controllers/Auth.ts` and tests.
- Codegen/OpenAPI: `src/codegen/astExtract.ts`, `src/codegen/astResolve.ts`,
  `src/codegen/astSpec.ts`, `src/codegen/astEmit.ts`, generated-type fixtures/tests,
  `src/services/documentation/OpenApiGenerator.ts` and tests.
- Public surface: no `package.json` change (the `./services/*` export covers `responses.js`);
  generated declaration packaging smoke test.
- Documentation: controller responses, streams/files, error handling, OpenAPI, v5.3 adoption,
  v6 migration, and `CHANGELOG.md`.

The file set is finalized after Phase 0 fixes the module/export layout; later phases must update
this list before touching additional production files. Phases 0–1 touched: the three new modules
and their tests, `ExpressAdapter.ts`, `HttpServer.ts`, `ExpressAdapter.test.ts`,
`controllers/index.test.ts` and `CHANGELOG.md`; `controllers/index.ts` was not needed.

## Out of scope for v5.3

- Removing Express, changing the server/listener, or shipping `NodeAdapter`.
- Removing `res`/`next` from legacy controllers or middleware.
- Inferring thrown errors by scanning controller bodies.
- Runtime response validation or `fast-json-stringify` by default.
- WebSocket/`CONNECT` raw-route API design.
- SSE, trailers, early-hints, and HTTP/2-specific helpers beyond reserving their seams.
- A breaking change to `registerErrorHandler` results.

## Done when

- A consumer controller can return JSON, empty, redirect, stream, and authorized storage-file
  responses without calling Express; legacy handlers remain green in the same process.
- Framework validation/errors and built-in controllers traverse `ResponseWriter`.
- Returning a descriptor after mutating `res` fails loudly before a second response is attempted.
- OpenAPI emits accurate declared/structural statuses and content types; it never fabricates an
  unresolved body schema.
- A consumer can delete manual stream/redirect response code with no authorization or delivery change.
- Full tests, `npm run check:types`, `npm run check`, build, and packaging smoke test pass.
- v6 migration documentation states that ordinary `res` access is removed and identifies the two
  explicit escape levels.
