# Consumer review fixes (post-5.5.0)

**Status:** implemented 2026-10-06; ships in [5.5.1](release-5.5.1.md). #1 was held back for 5.6: [validation-errors-registry](../queued/validation-errors-registry.md).

An app-side review of 5.5.0 raised seven points. Verified against the source; this plan covers the ones that need framework work.

## Settled

| # | Point | Decision |
|---|---|---|
| 4 | `Auth.middleware` now only throws, so its inferred return type narrowed to `Promise<void>`; a subclass that answers with `res.json(...)` fails with TS2416. Same for `Role`. | Annotate both with the base return type (`Promise<void \| Response>`); `RateLimiter` still has a `res.json` path, so it kept the wide type. A test subclasses all three. Patch. |
| 5 | `generateToken`'s stale-password guard surfaces raw Mongoose `VersionError` / `DocumentNotFoundError`; every custom login has to copy the controller's catch or answer 500. | The model rethrows them as `BadRequestError({ i18nKey: 'auth.errorUPValid', message })`, the exact body of a wrong password (no code: the two must stay indistinguishable). The controller's catch goes. Patch. |
| 1 | The validation catch answers framework `ValidationError`s directly, so they are the one error a registered handler cannot reshape. | Moved to [validation-errors-registry](../queued/validation-errors-registry.md) (5.6): a behavior change for catch-all handlers, so not in a patch. |
| 6 | An app's own `controllers/Health.ts` replaces the built-in controller. | Docs only. The override line already prints at the default console level (`silly`); raising it to `info` would only add it to Sentry. Add the upgrade note to the 5.5.0 entry and the deploy chapter. The `05-models` API comment also says what `generateToken` now rejects with. |
| 3 | `Role`/`RateLimiter` bodies gained `error`. | Additive; the old bodies had no `error`. Reword the 5.5.0 entry only. |

## Not doing

- **2 — export the `HttpError` mapper.** The need is reshaping framework bodies into an app envelope; `transformResponse` in [universal-http-responses](universal-http-responses.md) is the planned answer and covers 404/500/validation too. Revisit if a second app needs it before P1q.
- **7 — configurable `Role` field.** An app with a single `role` adds a Mongoose virtual `roles` → `[this.role]`; no framework change.

## Verification

All five gates from AGENTS.md.
