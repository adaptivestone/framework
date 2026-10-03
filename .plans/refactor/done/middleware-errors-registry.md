# middleware-errors-registry — the registry finally reaches the middleware layer

**Status**: ✅ implemented 2026-10-03; unreleased (5.5.0), non-breaking on the wire. Origin: a 5.4 source review (2026-09-01); this is "option C" from the i18n-defaults design round, made v5-viable by the byte-identical-body trick.
**Depends on**: [error-handler-registry](../done/error-handler-registry.md) (P1p) ✅. **Co-design with**: [async-middleware](../queued/async-middleware.md) (P1m — its v2 contract routes throws through the registry at the adapter level; this plan covers the v1/global layer via the sink) and [P1q](../queued/universal-http-responses.md).

## Problem

`resolveError`'s own docstring: middleware throws bypass the registry and hit the generic 500 sink. Consequences: (1) the framework ships `UnauthorizedError` and its own Auth middleware doesn't use it — Auth/Role/RateLimiter predate the registry and write ad-hoc `res.json`; (2) two shapes for one meaning — handler-thrown 401 answers `{message}`, middleware 401 answers `{error, message}`; (3) zero app override power — `registerErrorHandler(UnauthorizedError, …)` affects no real middleware-produced 401/403/429.

## Design (three steps + one addition the sketch missed)

1. **Registry-aware final sink**: `addErrorHandler`'s 4-arg sink calls `await resolveError(err, req)` first (after the `headersSent` guard); a match answers `{status, body}` and logs at the entry's `logLevel`; null falls through to today's 500 + error log. `resolveError` already contains handler-throw containment — no crash loop.
2. **`headers` on `ErrorHandlerResult`** (additive): RateLimiter's 429 sets `Retry-After`; without a headers channel the migration would drop it. Optional `headers?: Record<string,string>` applied by both the controller catch and the sink.
3. **Migrate built-ins to throw** coded errors that render the same wire body: `throw new UnauthorizedError({ code: 'AUTH001', i18nKey: 'middleware.auth.notLoggedIn', message: 'Please login to application' })` answers `{ error, message }` exactly as today (the mapper translates; see [coded-http-errors](../done/coded-http-errors.md) — the positional `body` trick is deprecated). Auth 401, Role 401/403, RateLimiter 429 (+`Retry-After` via headers). RequestParser 413/400 optional follow-up (plain `HttpError`). Keep the existing log lines at the throw sites.
4. Regression tests: middleware-throw → registry-handled (not 500); byte-identical bodies for all migrated responses; app `registerErrorHandler(UnauthorizedError, …)` now reshapes the middleware 401; `Retry-After` preserved; headersSent guard intact.

## Behavior change (flagged, wanted)

A custom middleware throwing `HttpError` today → 500; after → mapped status. That is the documented intent of `HttpError` finally honoured in the middleware layer. CHANGELOG behavior-change entry, house style.

## Out of scope

P1m v2 adapter dispatch (its own card); handler-path behavior (already registry-covered); 404 sink (no error object flows there).

## Done when

Sink consults the registry; built-in middleware throw typed errors with byte-identical wire responses (tests prove it); `headers` lands on `ErrorHandlerResult`; app override of a middleware 401 demonstrated in a test; full battery green.

## As shipped (2026-10-03)

- The final sink (`HttpServer.addErrorHandler`) checks `headersSent` first, then calls
  `resolveError`; a match is logged at its entry's level (`toLoggableError`) and sent, anything
  else keeps the 500 + error log.
- `ErrorHandlerResult.headers` plus `HttpError` details `headers` (both the contract and the custom
  `body` form): the built-in mapper copies them into the result. One sender,
  `sendErrorResult(res, result)`, serves the two controller catches and the sink.
- Built-ins throw: Auth → `UnauthorizedError` `AUTH001` (byte-identical); Role 401 →
  `UnauthorizedError` `AUTH001` (same meaning for the client: log in), Role 403 → `ForbiddenError`
  `NO_ACCESS`, RateLimiter 429 → `HttpError(429)` `TOO_MANY_REQUESTS` with `Retry-After` in
  `headers`. The codes are the only wire change (an added `error` field). Existing log lines kept.
- Not migrated: RateLimiter's operator-facing 500 (untranslated by design), RequestParser 413/400
  (the optional follow-up).
- Tests: unit tests resolve the thrown error through the real registry; end to end, the `Auth`
  401 body is exact, an app `registerErrorHandler(UnauthorizedError, …)` reshapes it, and the
  429 carries its body and `Retry-After`; sink tests cover headers, an app handler and the
  `headersSent` hand-off.
