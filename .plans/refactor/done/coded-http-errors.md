# Coded, translatable `HttpError`

**Status**: ✅ implemented 2026-10-02 in the working tree; unreleased
**Release**: next minor `5.5.0` (additive)
**Origin**: consumer feedback. `HttpError` carries only `status` + `message` (+ `body`), so an app
with coded, translated errors keeps its own error classes, English message tables and near-identical
`registerErrorHandler` handlers in `bootHttp`.
**Reverses** two P1p v1 decisions ([error-handler-registry](../done/error-handler-registry.md)):
"`code` field on `HttpError`: NO for v1" and "i18n of error messages: out of scope". Deliberate: a
real consumer needs both, and the `body` override forces every app to rebuild translation itself.

## Decision

```ts
throw new ConflictError({
  code: 'ALREADY_CONFIRMED',                    // sent as `error`
  i18nKey: 'accounts.errors.alreadyConfirmed', // server-only: what to translate
  message: 'This account is already confirmed.', // English fallback + log line
});
// → 409 { "error": "ALREADY_CONFIRMED", "message": "<translated or English>" }
```

- Object in place of the message string: `new HttpError(status, details)`, `new XError(details)`.
  Non-breaking — the documented `(message, body?)` form is unchanged (a 3rd-arg options object
  would collide with the public `body: unknown`).
- `message` required (English stays in code, the i18n-defaults invariant); `code` and `i18nKey`
  optional and independent. Both are readable on the instance; `i18nKey` never reaches the client.
- Mapper: explicit `body` still wins. Otherwise `{ error?: code, message }` — same shape as the Auth
  middleware's `{ error: 'AUTH001', message }`. `message` is the `i18nKey` translation when present,
  else the English `message`.
- No derived keys (`errors.<code>`): the app names the key. No framework-owned prefix in app
  catalogs, existing app keys keep working, and literal keys stay visible to i18n tooling.
- Translated with `skipInterpolation: true`: a missing key falls back to `message` literally, so
  `$t(...)` nesting / `{{…}}` in a message that embeds request data is never interpreted
  (verified: without it i18next expands `$t()` inside `defaultValue`). Error messages take no
  params, so nothing is lost. `translateWithDefault` (framework constants only) is unchanged.

## Rejected / deferred

- `errors.<code>` derived key: magic prefix, forces key migration, dynamic keys hide from tooling.
- Treating any message as a key (P1q's `new NotFoundError('user.notFound')` example): `.`/`:` are
  i18next separators, so sentences would be mangled. P1q example updated.
- `params` interpolation: deferred, consistent with i18n-default-values (no `params` arg).
- Response envelopes (`data: null`): P1q `transformResponse`.

## Files

`src/services/http/httpErrors.ts`, `builtinErrorHandlers.ts`, their tests, `CHANGELOG.md`,
`queued/universal-http-responses.md` (example), `queued/middleware-errors-registry.md` (note);
docs repo `06-Controllers/04-error-handling.md`, `08-i18n.md`.

## Out of scope

Built-in middleware migration (its own plan; it can now throw `{ code: 'AUTH001', i18nKey:
'middleware.auth.notLoggedIn', message }` instead of a pre-translated body); code in log lines;
OpenAPI error codes.

## Done when

Object form constructs on the base and every subclass; mapper returns `{ error, message }` with
the translation or the literal English fallback; `i18nKey` never appears in a body; explicit `body`
wins; `$t()` in a message stays literal; legacy forms unchanged; the AGENTS.md gates pass.
