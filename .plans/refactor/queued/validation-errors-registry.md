# Request-validation 400s through the error-handler registry

**Status:** queued for 5.6, implemented and verified 2026-10-06, then held back from 5.5.1 (behavior change → minor). Split out of [consumer-review-fixes](../done/consumer-review-fixes.md).

## Problem

The validation catch in `src/controllers/index.ts` answers a framework `ValidationError` directly. It is the one error a `registerErrorHandler` entry cannot reshape; every other path (handler, middleware, the Mongoose safety nets) walks the registry.

## Settled

- **Registry first, 400 fallback.** The validation catch calls `resolveError` before its own `ValidationError` check; unresolved, the current 400 is unchanged. Covers `params:`, `request:` and `query:` (same `try`).
- **No global built-in `ValidationError` entry.** It would also turn a `ValidationError` thrown inside a handler or middleware (server-side data) from 500 into 400.
- **Types.** `ValidationError` widens `message` to its payload, so it is not an `Error` type and `registerErrorHandler(ValidationError, …)` failed to compile. The registry constraint becomes a structural `export type RegistrableError = Omit<Error, 'message'>` in `builtinErrorHandlers.ts`, used by `ErrorHandlerFn`, `RegisteredErrorHandler` and `HttpServer.registerErrorHandler`. Naming `ValidationError` there instead pulls its declaration into the core entry, and the packaging smoke test (`skipLibCheck: false`) fails on it.
- **Behavior change:** a consumer handler registered for `Error` (catch-all) starts receiving validation errors → minor release.

## Implementation

A verified patch is kept locally (gitignored) at `.superpowers/sdd/validation-registry-5.6.patch`: `git apply` it, or redo from this description. Files: `src/controllers/index.ts`, `src/controllers/index.test.ts` (test: a handler registered for `ValidationError` turns the route-level 400 into a 422), `src/services/http/builtinErrorHandlers.ts`, `src/services/http/HttpServer.ts`.

Changelog (`### Changed`):

- **Request-validation 400s go through the error-handler registry.** A handler registered with `registerErrorHandler` for `ValidationError` (from `services/validate/ValidationError.js`) can now reshape the 400 answered when a route's `params:`, `request:` or `query:` schema rejects the input. With no such handler the response is unchanged. `registerErrorHandler` and `ErrorHandlerFn` now accept `ValidationError` in TypeScript. A handler registered for `Error` (a catch-all) now receives these validation errors too: return `null` for a `ValidationError` to keep the default 400.

Docs at release: one line in `06-Controllers/04-error-handling.md` that validation failures go through the registry.

## Relation to P1q

Complementary to [universal-http-responses](universal-http-responses.md): this lets a handler reshape one error class; P1q Phase 2 routes the validation 400 through the writer and `transformResponse`. Ship together in 5.6.

## Verification (2026-10-06, before the split)

926/926 tests, Biome, both type checks and the packaging smoke test passed with the patch applied.
