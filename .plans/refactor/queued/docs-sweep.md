# P1g — Docs sweep after v5 ships

**Status**: ⏸ deferred to v5.0.x or v5.1
**Depends on**: v5.0.0 stable release
**Time**: ~1 day
**Origin**: incremental docs updates during the refactor only touched the chapters most relevant to a given change. After v5 stabilizes, do a full sweep to bring every chapter in `framework-documenation-github/docs/` in line with current behavior.

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
