# Findings from app upgrades (after 5.7.0)

**Source**: two reports from moving production apps onto 5.6.1 and 5.7.0
(2026-11-22, kept outside the repository): items `FW1`–`FW28` and `TH1`–`TH7`.
**Status**: queued. The real, small items shipped in 5.7.0, and so did two
small additions from this card, FW20 (more `HttpError` subclasses) and TH7
(`passwordPolicyIssues`); see [release-5.7.0](../done/release-5.7.0.md). This
card keeps the rest, so they are planned rather than lost in the release card.

Each item says what is wrong, the direction agreed so far, and what still
needs a decision. Versions are targets, not promises.

## Rate limiting

- **Per-request limits (TH3).** Limits are merged once in the constructor, so
  a limit that depends on the request (an API token's plan, stricter limits
  for anonymous callers) forces apps to rebuild the Redis store, memory
  insurance, fail-open and 429 handling. Direction: an optional async
  `resolveLimit(req)` returning `{ points, duration, key? }` or `null` (skip);
  the framework caches one limiter per distinct `(points, duration)` and keeps
  its key hashing, fail-open, 429 and insurance. Target 5.8.
- **Auth policies (FW11).** Normalizers for request fields (phone spellings),
  counting only failures, progressive backoff. Policy choices; design with
  TH3 so both use one hook shape.
- **Redis warm-up window.** With `rejectIfRedisNotReady: true`, the first
  requests after a worker starts count in that worker's fresh memory
  insurance until `connect()` resolves, so a key that used up its shared
  budget briefly gets a full one. Direction: a short bounded wait while the
  client is connecting.
- **Malformed `redis.url` (TH2 follow-up).** 5.7.0 keeps the misconfiguration
  500 (as for a missing `@redis/client`) and names `redis.url` in the error,
  logged on the first request through the limiter. Decision needed: fail fast
  at boot when a Redis-backed driver (rate limiter or cache) has a malformed
  URL, or fail open to the memory insurance. Owner's standing preference:
  misconfiguration is reported loudly, not silently worked around.

## Errors

- **Duplicate-key errors (TH4).** A unique-index violation (`MongoServerError`
  / `MongoBulkWriteError` code 11000) reaches the generic 500; only the built-in
  registration maps it, privately. Direction: a built-in registry entry that
  answers `409 { error: 'DUPLICATE_KEY', message, errors: { <path>: [...] } }`
  built from `keyPattern` only, never `keyValue` (it holds the submitted value).
  The registry sees errors from `save`, `updateOne`, `findOneAndUpdate` and
  `insertMany` alike, which a `post('save')` hook does not. Decision needed:
  500 → 409 is visible to clients, so ship it by default in a minor or behind a
  config flag; per-path messages (reuse the Mongoose validation i18n path, or a
  schema option). The docs already show a registry handler with
  `mongoose.mongo`.
- **An `HttpError` from a registry handler (FW13).** A handler can return an
  `HttpResponse` or `{ status, body }`, but not an `HttpError` for the contract
  mapper. Direction: accept a returned `HttpError` and map it as if thrown.
- **Temp-file write errors answer 400.** A failed temp-file write during
  upload parsing (disk full, a missing `uploadDir`) answers the parser's
  `400 MALFORMED_BODY`, for multipart and octet-stream alike; it is a server
  failure and should be a 500.
- **Interpolation in `i18nKey` (FW12).** `HttpError` messages are translated
  with interpolation off. Direction: an `i18nParams` field, keeping the safe
  fallback when a key is missing.
- **One list of error codes (FW21, 5.7.0 note).** The built-in `Auth` answers
  carry no `error`, and the middleware codes `AUTH001`, `NO_ACCESS` and
  `TOO_MANY_REQUESTS` are not in `FRAMEWORK_ERROR_CODES`. Direction: add them to
  the exported list without renaming what clients already receive (`AUTH001`
  stays); give the `Auth` answers codes.

## Health and deploys

- **Composable readiness (FW14, 5.7.0 note).** `pingMongo` is private, so an
  override calls `super.ready`, narrows the response and reads its body; one
  that answers through `res` after `super.ready` inherits the built-in status.
  Direction: a `checks()` hook that the built-in `ready` merges.
- **Which process answered (TH6).** Deploy probes on shared hosts cannot tell
  the restarted process from an old one holding the port. Direction: with a
  valid `HEALTH_TOKEN`, add `instance: { pid, primaryPid, startedAt, version }`;
  design together with `checks()` so the response shape changes once.
  Optional: a `wait-for-ready` CLI command that reads the port and token from
  the resolved config.
- **Clean worker exits (TH5 follow-up).** 5.7.0 warns when a worker exits with
  code 0 outside a shutdown, with the number left. Decision needed: a
  `restartOnCleanExit` option for HTTP clusters, and its default.

## Auth

- **A ready-made password schema.** 5.7.0 exports `passwordPolicyIssues`
  (TH7); a schema helper carrying the same keys is optional.
- **Session tokens (FW15 remainder).** Per-token TTL, metadata, a revocation
  helper and "log out everywhere".
- **Timing-equalizer hash.** An opt-out for processes that never verify
  passwords (5.7.0 computes it when the HTTP server starts), and a fresh hash
  when the configured cost changes (the cached one keeps the old cost).

## Logging

- **Redaction (FW1).** Messages, stacks and nested `Error` fields can carry
  values the redact list names. Decide with
  [logging-facade-and-pino](logging-facade-and-pino.md); includes the decision
  on what the framework logs about client errors (the body-parser message and
  the Mongoose safety-net field path, kept as in 5.6.1 for 5.7.0).
- **Console fields (FW8).** The console transport prints only the message and
  drops structured fields.
- **Unhandled rejections (FW7).** Only logged; an opt-in crash policy.
  `--unhandled-rejections=strict` already exists, so this may be docs only.

## Types, tests, tooling

- **Config types from runtime values (FW9, second half).** Generated config
  types depend on the environment codegen ran in (for example `http.port`).
- **Test-harness options (FW16).** The differences are documented (memory rate
  limiter, `autoIndex` off, shallow `updateConfig`, cached middleware);
  options to turn them off remain.
- **A locale test for stale keys.** 5.7.0 checks that every framework key
  exists in each non-English catalog; extra keys the source no longer uses are
  not reported.
- **Importable commands and required indexes (FW18).** Later; new public
  surface.

## Covered by other plans

- Per-route body limits and parsing after routing and auth (FW4):
  [async-middleware](async-middleware.md) (P1m).
- OpenAPI response bodies (FW22, 5.7.0 note on `JsonResponse` types):
  [openapi-responses](openapi-responses.md), 5.8.
