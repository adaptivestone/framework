# P1g — Docs sweep after v5 ships

**Status**: ⏳ in flight — first full pass done 2026-06-06 (every chapter reviewed once; build green). Re-sweep before publish.
**Depends on**: v5.0.0 stable release
**Time**: ~1 day
**Origin**: incremental docs updates during the refactor only touched the chapters most relevant to a given change. After v5 stabilizes, do a full sweep to bring every chapter in `framework-documenation-github/docs/` in line with current behavior.

## Pass 1 — 2026-06-06 (grep-driven + per-chapter audit)

Repo-wide grep for removed-API signals + parallel per-chapter audit against CHANGELOG `[5.0.0-next]` + `src/`. Fixed:

- `01-intro.md` — "ESM and CommonJS compatibility" → ESM only; dropped `views/` from folder structure (VIEWS removed).
- `06-Controllers/01-intro.md` — replaced dead "## View" section (Express/Pug `res.render`, view rendering removed in v5) + stripped two garbage lines (`++++...`, `[message is too long]`).
- `06-Controllers/03-middleware.md` — removed the contradictory `StaticFiles` usage tail (import + `folders` param + example) under the "removed in v5 / use nginx" warning.
- `09-testsing.md` — de-jested the commented `__mocks__` example (`jest.*` → `vi.*`, idiomatic vitest manual mock).
- `03-files-inheritance.md` — framework-package imports `.ts` → `.js` (published as `dist/*.js`); project-own source stays `.ts`.
- `14-helpers.md` — `redisConnection.ts` → `.js` (was the only `.ts` outlier in the file).
- `04-base.md` — `${__dirname}` → `${import.meta.dirname}` (ESM-only; min Node 20.12).
- `05-models.md` (`firtsName`→`firstName`), `05-modelsOld.md` (typos in the deprecation banner), `08-i18n.md` (`instanse ptovides`→`instance provides`).

Verified accurate (no change): `02-configs`, `07-logging`, `08-i18n` (body), `11-cache` (Redis-only today — memory driver still unshipped, P1c), `12-email` (already points at `@adaptivestone/framework-module-email`), `10-cli` / `06-Controllers/02-routes` (updated earlier). `05-modelsOld` correctly framed as legacy.

**Deliberately NOT changed (audit false-positives / out of v5-scope):** `13-deploy.md` nginx serving `src/public` — that IS the v5-recommended replacement for the removed StaticFiles middleware, not stale; `node:latest` / pm2 entry-point name — project-dependent, not a v5 staleness bug.

**Remaining before publish:** re-read deep prose in `05-models.md` (long chapter) and verify all cross-chapter anchor links; a final pass once v5.0.0 is tagged stable.

## Goal

Audit every doc file under `framework-documenation-github/docs/` against current v5 behavior. Fix every chapter where the prose still describes pre-v5 mechanics (Express router internals, plain-object validators, instance-side schema getters, etc.).

## Files to review (exhaustive)

- `01-intro.md` — Framework overview, links to chapters
- `02-configs.md` — Config inheritance, env vars
- `03-files-inheritance.md` — File-override mechanism
- `04-base.md` — `Base` class, `loggerGroup`
- `05-models.md` / `05-modelsOld.md` — Mongoose / `BaseModel`
- `06-Controllers/01-intro.md` — ✅ updated this session
- `06-Controllers/02-routes.md` — ✅ updated this session
- `06-Controllers/03-middleware.md` — ✅ updated this session
- `07-logging.md` — Logger + transports; mention boot route tree log + `shutdown` listener behavior
- `08-i18n.md` — Validation-error translation flow
- `09-testsing.md` — `vitest` v4, framework helpers, test patterns
- `10-cli.md` — ✅ updated this session
- `11-cache.md` — Cache service, Redis driver
- `12-email.md` — Updated for `@adaptivestone/framework-module-email` extraction
- `13-deploy.md` — Cluster mode, env vars, production considerations
- `14-helpers.md` — `appInstance`, `yup` helpers, `getRedisClient` patterns

## What to check per chapter

- Pre-v5 examples that still reference removed APIs (`AbstractController` third arg `isExpressMergeParams`, plain-object validators, `app.documentation`, etc.)
- Path-syntax examples (Express 5 optional `{:name}` no longer supported — see CHANGELOG breaking-changes)
- Imports — should they be `.js` (per the framework's exported-from-`dist` convention)?
- Links between chapters — broken / stale anchors

## Out of scope

- Restyling, theme work, sidebar reorg
- Translating to other languages
- Migrating from Docusaurus to anything else

## Done when

- Every chapter reviewed once; PR with chapter-by-chapter commits
- No prose example references a removed v4 API
- `npm run build` in the docs repo still passes
- Spot-check renderable: top three landing pages render visually correctly

## Trade-offs

- ~1 day of fairly mechanical work that produces no new features. Pure correctness.
- Easier if done while v5 is still fresh in head; harder later.
