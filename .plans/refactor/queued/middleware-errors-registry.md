# middleware-errors-registry — the registry finally reaches the middleware layer

**Status**: ⏸ queued — v5.5 candidate, non-breaking on the wire. Origin:  agent's 5.4 source review (2026-09-01); this is "option C" from the i18n-defaults design round, made v5-viable by the byte-identical-body trick.
**Depends on**: [error-handler-registry](../done/error-handler-registry.md) (P1p) ✅. **Co-design with**: [async-middleware](async-middleware.md) (P1m — its v2 contract routes throws through the registry at the adapter level; this plan covers the v1/global layer via the sink) and [P1q](universal-http-responses.md).

## Problem

`resolveError`'s own docstring: middleware throws bypass the registry and hit the generic 500 sink. Consequences: (1) the framework ships `UnauthorizedError` and its own Auth middleware doesn't use it — Auth/Role/RateLimiter predate the registry and write ad-hoc `res.json`; (2) two shapes for one meaning — handler-thrown 401 answers `{message}`, middleware 401 answers `{error, message}`; (3) zero app override power — `registerErrorHandler(UnauthorizedError, …)` affects no real middleware-produced 401/403/429.

## Design (three steps + one addition the sketch missed)

1. **Registry-aware final sink**: `addErrorHandler`'s 4-arg sink calls `await resolveError(err, req)` first (after the `headersSent` guard); a match answers `{status, body}` and logs at the entry's `logLevel`; null falls through to today's 500 + error log. `resolveError` already contains handler-throw containment — no crash loop.
2. **`headers` on `ErrorHandlerResult`** (additive): RateLimiter's 429 sets `Retry-After`; without a headers channel the migration would drop it. Optional `headers?: Record<string,string>` applied by both the controller catch and the sink.
3. **Migrate built-ins to throw**: `throw new UnauthorizedError(..., { error: 'AUTH001', message: translateWithDefault(req, 'middleware.auth.notLoggedIn', '…') })` — the carried body keeps every wire response **byte-identical** (the HttpError mapper answers `body ?? {message}`). Auth 401, Role 401/403, RateLimiter 429 (+`Retry-After` via headers). RequestParser 413/400 optional follow-up (no dedicated subclass; plain `HttpError`). Keep the existing log lines at the throw sites.
4. Regression tests: middleware-throw → registry-handled (not 500); byte-identical bodies for all migrated responses; app `registerErrorHandler(UnauthorizedError, …)` now reshapes the middleware 401; `Retry-After` preserved; headersSent guard intact.

## Behavior change (flagged, wanted)

A custom middleware throwing `HttpError` today → 500; after → mapped status. That is the documented intent of `HttpError` finally honoured in the middleware layer. CHANGELOG behavior-change entry, house style.

## Out of scope

P1m v2 adapter dispatch (its own card); handler-path behavior (already registry-covered); 404 sink (no error object flows there).

## Done when

Sink consults the registry; built-in middleware throw typed errors with byte-identical wire responses (tests prove it); `headers` lands on `ErrorHandlerResult`; app override of a middleware 401 demonstrated in a test; full battery green.
