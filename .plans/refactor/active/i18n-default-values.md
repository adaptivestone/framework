# P1y-bridge — i18n default values (English-in-code, optionally translatable framework messages)

**Status**: 🔄 active — PR 1 ✅ committed (`d40c4fd`); PR 2 implemented + verified (763 green, smoke asserts no-i18next consumer serves English), in working tree pending user review. Notables vs spec: `EN` const table in Auth.ts (multi-site keys); `password.wrongToken` default is NEW wording (key never had a catalog entry — needs sign-off); 9 keys with no framework emit site kept in `en/translation.json`; new `getI18nBaseInstanceIfAvailable()` on the i18n service (detectLang must not 500 without i18next); consumer without i18next needs `skipLibCheck: true` (2 benign TS2307 in shipped d.ts otherwise — same trade-off as @redis/client/yup, documented in CHANGELOG). Follow-up ticket found: `verification` email templates hardcode Russian strings, no t() at all. User decisions 2026-08-31: `password.wrongToken` wording APPROVED; missing-i18next report level = **warn** (expected fresh-install state, framework stays functional; hard throw in `getI18nBaseInstance()` unchanged); NO framework-owned structural i18n types now (skipLibCheck:true is tsc-init + template default, partial fix can't remove all TS2307, @redis/client/yup precedent) — typed t/keys surface belongs to P1y Phase 2/3. Locale files stay until P1y Phase 4 (framework's own tests + translator source are their remaining consumers); 4 provably dead en keys (`auth.userProvided/errorUExist/errorUAlready/noAccessRights`) may be trimmed on request; `email.verify/emailConfirm/newPassword` ride the verification-template ticket.
**Depends on**: nothing. **Feeds**: [P1y](../queued/i18n-contracts-and-tooling.md) Phase 4 (v6 `framework` namespace cutover — its codemod must carry the keys added here).
**Decided**: 2026-08-31 with three-way review (Claude design + grok/codex critiques + cross-framework research). Pattern = Spring's `getMessage(code, args, defaultMessage)`: key + in-code English default at the emit site; the always-loaded vendor catalog (Laravel/Rails/Django model) arrives later via P1y Phase 4, with `defaultValue` staying as the safety net.

## Problem

Framework middleware returns hardcoded English (`Please login to application`) — untranslatable. Framework controllers/validation/email use bare i18n keys with **no default** — when the app's locale files lack a key (the example project copied only 3 of 26), the **raw key leaks** into API responses (`auth.messageSome`). With `i18n.enabled: false` the fallback `t = (text) => text` leaks keys too, so i18n is not genuinely optional today.

## Design invariants

- Keys are framework-authored constants; **no user input ever reaches `t()`** (no ValidateService-style injection surface).
- `defaultValue` in code is the **single English source of truth**. No new entries in `src/locales/*` (avoids drift + fallbackLng-beats-defaultValue double-source).
- A present key always beats `defaultValue` → existing app translations keep working unchanged; the miss case upgrades raw-key → English.
- Status codes and machine codes (`error: 'AUTH001'`) never change; translated text is never used programmatically.
- Key namespace stays bare (`middleware.*`), consistent with existing `auth.*`/`email.*`; P1y Phase 4 renames all of them to `framework:*` together.

## PR 1 — middleware (in flight)

1. **`src/services/i18n/I18n.ts`** — `#i18nFallback.t` honours defaults, both i18next overloads:
   ```ts
   t: ((key, options) =>
     typeof options === 'string' ? options : (options?.defaultValue ?? key)) as TFunction,
   ```
   Calls without a default keep returning the key (existing behavior).
2. **`src/services/http/middleware/AbstractMiddleware.ts`** — protected helper (no `params` arg — nothing interpolates yet, and spreading params into `t()` options collides with i18next control keys; add a `replace`-based variant only when needed):
   ```ts
   protected translate(req: FrameworkRequest, key: string, defaultValue: string): string {
     const translated = req.appInfo?.i18n?.t(key, { defaultValue });
     return typeof translated === 'string' ? translated : defaultValue;
   }
   ```
   Guards: absent `appInfo.i18n` (direct instantiation/tests) and non-string `t()` returns (malformed resource / `returnObjects`).
3. **Call sites — 6 keys, 7 sites** (defaultValue = current text byte-for-byte):

   | Key | defaultValue | Site |
   |---|---|---|
   | `middleware.auth.notLoggedIn` | Please login to application | Auth.ts 401 |
   | `middleware.role.userRequired` | User should be provided | Role.ts 401 |
   | `middleware.role.noAccess` | You do not have access | Role.ts 403 |
   | `middleware.rateLimiter.tooManyRequests` | Too Many Requests | RateLimiter.ts 429 |
   | `middleware.requestParser.entityTooLarge` | Request entity too large. Your upload exceeds the allowed size or count limits. | RequestParser.ts 413 ×2 |
   | `middleware.requestParser.parseError` | Error to parse your request. You provided invalid content type or content-length. Please check your request headers and content type. | RequestParser.ts 400 |

   Deliberately excluded: RateLimiter 500 `RateLimiter error` (ops-facing, not user language); Pagination schema message (no `req` in scope — PR 2 decides); HttpServer 404/500 sinks (not middleware).
4. **Tests**: fallback-`t` both overloads + no-default → key; per middleware: no key → exact current English, stubbed `appInfo.i18n` resolving key → translation wins; one non-string-`t`-return → defaultValue. Existing tests stay green untouched (they lock byte-identical English).
5. **CHANGELOG** Unreleased/Added: middleware messages optionally translatable via `middleware.*` keys (table); note `saveMissing: true` writes English defaults to `*.missing.json` (translator starter).

## PR 2 — framework-wide sweep + i18next optional (queued behind PR 1)

- **Sweep** (~25 sites): `controllers/Auth.ts` direct `t()` calls, built-in validation schema messages (`params: { defaultValue }` — `translateInPlace` already passes params to `t()`, framework-authored so trusted), email subjects/templates. Keys unchanged; defaults extracted verbatim from `src/locales/en/translation.json`. **Behavior change** (CHANGELOG-flagged): missing framework keys now fall back to English instead of leaking the raw key.
- **Trim `src/locales/en/translation.json` entries** covered by in-code defaults (provably identical output). `ru/translation.json` stays shipped through v5; its catalog migrates to bundled `framework.json` in P1y Phase 4.
- **i18next → optional peer dep** (`i18next` + `i18next-fs-backend`), the `@redis/client` pattern: type-only static imports already hold everywhere, runtime `import()` already gated on `enabled`; move to `peerDependencies` (optional meta) + `devDependencies`, clear error if `enabled: true` without them installed, packaging smoke test asserts a consumer without i18next boots and serves full English. Watch `postbuild` (copies `src/locales` to dist — keep, ru still shipped).

## Follow-ups in other repos (after PR 1 merges)

- **Docs repo** (`framework-documenation-github`): i18n chapter — defaultValue behavior, overridable-key table, nested-JSON shape, ru copy-paste example, "i18n is optional" section, saveMissing note; middleware chapter — `translate()` helper for consumer middleware; behavior-change note for PR 2.
- **Example repo** (`framework-example-project`): showcase `middleware.auth.notLoggedIn` override in en+ru; revisit its partial `auth.*` copies after PR 2. Docker-only verification.

## Done when

PR 1: `npm test` / `npm run check` / `npm run check:types` green; untranslated responses byte-identical to 5.3.0-unreleased; a key in app locales translates the message; disabled i18n yields English.
PR 2: additionally `npm run smoke` green without i18next in the consumer; no raw framework key can reach a response.
