# OpenAPI: required vs optional auth

**Status**: ✅ implemented 2026-10-02; unreleased
**Release**: next minor `5.5.0` (fix + additive `requiresAuth`)
**Origin**: consumer feedback — public routes were documented as needing a token, so the frontend's
generated API client demanded one.

## Cause

`collectSecurity` turned every middleware declaring `usedAuthParameters` into a **required**
security requirement. The only declarer, `GetUserByToken`, merely reads a token if present; the
enforcement lives in `Auth` (401 without a user) and `Role` (401/403), which declared nothing. So
`/auth/login`, `/register`, etc. (`[GetUserByToken, RateLimiter]`) were documented as secured.

## Decision

- `AbstractMiddleware.requiresAuth` (static getter, default `false`); `Auth` and `Role` return `true`.
  Apps set it on their own enforcing middleware.
- Generator rule (maintainer): one `requiresAuth` middleware anywhere in the chain → the whole route
  requires auth (`security: [{ scheme: [] }, …]`); only readers → optional (`[{}, …]`, OpenAPI's
  "anonymous allowed"); no reader → no `security`.
- `usedAuthParameters` renamed to `authSchemes` (maintainer: the old name did not say what it is or
  how it is used). Reuse for "required" was rejected: the reader (`GetUserByToken`) sits on public and
  protected routes alike, and the enforcers (`Auth`, `Role`) read no credentials. Old name = deprecated
  alias until v6: the base static getter returns `this.authSchemes`; the generator falls back to a
  subclass that overrides only `usedAuthParameters` (`ASF_DEP_MW_USED_AUTH_PARAMETERS`, once per class).

## Not here

`201` vs the hard-coded `200` and response schemas → [openapi-responses](../queued/openapi-responses.md)
(P1q Phase 3: declared `responses:` / typed return descriptors). Structural `400/401/415` (its
Option 1 / D4) is ON HOLD by the maintainer (2026-10-02): it will be designed together with the
full responses work, which can build on `requiresAuth`.

## Files

`src/services/http/middleware/AbstractMiddleware.ts`, `Auth.ts`, `Role.ts`, `GetUserByToken.ts` (+ test),
`src/services/documentation/OpenApiGenerator.ts` (+ test), `CHANGELOG.md`; docs repo
`17-openapi.md`, `06-Controllers/03-middleware.md`.
