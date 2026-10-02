# Coded, translatable `HttpError` and one error contract

**Status**: ✅ implemented 2026-10-02; unreleased
**Release**: next minor `5.5.0` (additive + one flagged wire change)
**Origin**: consumer feedback. `HttpError` carried only `status` + `message` (+ a free-form `body`),
so an app with coded, translated errors kept its own error classes, English message tables and
near-identical `registerErrorHandler` handlers in `bootHttp`.
**Reverses** two P1p v1 decisions ([error-handler-registry](error-handler-registry.md)): "`code`
field on `HttpError`: NO for v1" and "i18n of error messages: out of scope".

## Contract

Every framework error response follows `{ error?: string, message: string, errors?: { [path]: string[] } }`:
`error` = machine code, `message` = human text, `errors` = field errors, always arrays per path
(`pathToString` form, as request validation). The maintainer's rule: the frontend can rely on
`body.errors` for field errors everywhere. The only way out of the contract is an explicit custom
`body`, which cannot be mixed with the contract fields.

## Decision

```ts
throw new ConflictError({
  code: 'ALREADY_CONFIRMED',                    // sent as `error`
  i18nKey: 'accounts.errors.alreadyConfirmed', // server-only: what to translate
  message: 'This account is already confirmed.', // English fallback + log line
  errors: { email: 'accounts.errors.emailTaken' }, // optional field errors
});
// → 409 { "error": "ALREADY_CONFIRMED", "message": "…", "errors": { "email": ["…"] } }
```

- Details object in place of the message string on the base and every subclass; the plain
  message string stays (mirrors `new Error(message)`), non-breaking.
- `message` required (English stays in code); `code`, `i18nKey`, `errors` optional and independent.
- The app names the translation key — no derived `errors.<code>` key (no framework-owned prefix in
  app catalogs, existing keys keep working, literal keys visible to i18n tooling). Translated with
  `skipInterpolation: true`: a missing key falls back to `message` literally, so `$t(...)`/`{{…}}` in
  a message that embeds request data is never interpreted (i18next expands `$t()` inside
  `defaultValue` otherwise — verified on 26.4.2).
- `errors` accepts `ValidationError`'s own constructor input (`{ field: msg | [msg] }` or
  `ValidationIssue[]` with `params`), normalized by `new ValidationError(...)`, stored as
  `err.issues`, rendered with `issuesToPayload`, and translated by the SAME key allow-list rule as
  request validation (`translateIssues`, moved from `ValidateService` into `ValidationError.ts`;
  key-like messages translated, free text verbatim). Empty `errors` is dropped.
- Custom form `{ message, body }`: `body` IS the response (sent as-is; `message` only logged). It is
  exclusive with `code`/`i18nKey`/`errors` — a TypeScript error (union with `never` fields); at
  runtime `body` wins and `ASF_HTTP_ERROR_BODY_MIXED` (a `Warning`, once per class) names the
  ignored fields. Warning, not throw: a throw inside the app's own error construction would turn
  the intended 4xx into a 500. A named `details` extension slot was rejected (its relation to
  `errors` and to the body is unclear to developers and agents).
- The positional `body` argument is deprecated (`ASF_DEP_HTTP_ERROR_BODY`, `@deprecated`
  overloads) and removed in v6, leaving: a message string, the contract form, or the custom form.
- Alignment shipped with it (user-approved, CHANGELOG "Changed"): request-validation 400s gain
  `message` (`http.validationFailed` → "Validation failed"), and the Mongoose safety nets answer
  `{ message, errors: { field: [msg] } }` (values were plain strings).

## Audit (2026-10-02, Fable + independent inventory) — follow-ups, not in this change

31 framework error sites, 6 body shapes before this change. Remaining deviations:
- ✅ 2026-10-03 (5.5): 405, "Malformed URL" 400, 415, 404 and both 500 paths translate through
  `http.methodNotAllowed` / `http.malformedUrl` / `http.unsupportedContentType` (`{{types}}`) /
  `http.notFound` / `http.serverError`; one 500 text everywhere ("Something went wrong. Please try
  again later."), 404 default "Not found". RateLimiter's operator-facing 500 stays untranslated by
  design (documented in the i18n chapter).
- ✅ 2026-10-03 (5.5): `controllers/Auth.ts` translates through `translateWithDefault`; unverified login
  answers `{ error: 'EMAIL_NOT_VERIFIED', message, notVerified: true }` — `notVerified` deprecated,
  removed in v6.
- Only one machine code exists (`AUTH001`); Role 401/403 and RateLimiter 429 have none.
- Middleware throws bypass the registry (→ 500) — [middleware-errors-registry](../queued/middleware-errors-registry.md).
- Root-level validation issues are keyed `''` (v6 decision).
- OpenAPI emits description-only error stubs — the contract enables one shared `ErrorResponse`
  schema ([openapi-responses](../queued/openapi-responses.md)).

## Rejected

`errors.<code>` derived keys; any message as a key (`.`/`:` are i18next separators); `params` on the
top-level message (i18n-defaults decision); response envelopes (`data: null` → P1q `transformResponse`).

## Files

`src/services/http/httpErrors.ts`, `builtinErrorHandlers.ts`, `src/services/validate/ValidationError.ts`,
`ValidateService.ts`, `src/controllers/index.ts`, tests + `ErrorRegistryController` fixture,
`CHANGELOG.md`, plans; docs repo `04-error-handling.md`, `08-i18n.md`, `02-routes.md`.

## Done when

Details form on every class; `{ error?, message, errors? }` with translated message and field errors;
`i18nKey` never in a body; literal English fallback; validation and safety-net 400s carry `message` +
arrays; custom `body` is exclusive (type error; runtime warning); positional `body` works and warns
once per class; the AGENTS.md gates pass.
