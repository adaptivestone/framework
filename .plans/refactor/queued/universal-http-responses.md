# P1q — Universal typed HTTP responses (v5.3 bridge → v6 cutover)

**Status**: ✅ design direction settled 2026-07-18 · implementation not started  
**Target**: v5.3, additive; ordinary controller `res` removal is v6
**Depends on**: [tree-router](../done/tree-router.md) ✅, [error-handler-registry](../done/error-handler-registry.md) ✅  
**Feeds**: [OpenAPI responses](openapi-responses.md), [async middleware](../later/async-middleware.md), [NodeAdapter](../later/node-adapter.md), eventual [drop Express](../later/drop-express.md)  
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
  if (!user) throw new NotFoundError('user.notFound');
  return HttpResponse.json(200, user);
}
```

`registerErrorHandler` remains source-compatible. Its existing `{ status, body }` result is
normalized to `HttpResponse.json(status, body)` internally; a handler may additionally return an
`HttpResponse` directly when it needs non-default headers/content. The registry's log level and
first-match/null-fallthrough semantics do not change.

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
>
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

### Phase 0 — contract tests and API spike

- Lock factory names, status restrictions, descriptor branding, header semantics, and public
  exports in type/runtime tests.
- Prove Web stream and async-iterable writing through Express with abort propagation.
- Measure the semantic type-resolution options for OpenAPI; do not block the runtime layer on it.

### Phase 1 — additive runtime boundary

- Add `HttpResponse` types/factories, `ResponseWriter`, and `ExpressResponseWriter`.
- Teach controller dispatch to render branded returns and reject mixed legacy/new responses.
- Preserve every legacy return path byte-for-byte.

### Phase 2 — framework and error migration

- Route framework-generated responses and error-registry results through the writer.
- Migrate `Home`/`Auth` framework controllers to returned descriptors as fixtures for consumers.
- Keep legacy `{ status, body }` error-handler results accepted.

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
- Public surface: `package.json` exports if a dedicated subpath is chosen; generated declaration
  packaging smoke test.
- Documentation: controller responses, streams/files, error handling, OpenAPI, v5.3 adoption,
  v6 migration, and `CHANGELOG.md`.

The file set is finalized after Phase 0 fixes the module/export layout; later phases must update
this list before touching additional production files.

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
