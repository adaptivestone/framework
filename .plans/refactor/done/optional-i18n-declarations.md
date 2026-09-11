# Optional i18n declaration dependency

## Goal

A packed core consumer importing `helpers/appInstance.js` must compile with
`skipLibCheck: false` and neither `i18next` nor `i18next-fs-backend` installed.

## Decisions

- The September 11 consumer failure supersedes P1y-bridge's August 31 acceptance
  of mandatory i18next declaration imports and the `skipLibCheck` workaround.
- Publish dependency-free structural translation types for requests, validation,
  user mail methods and the i18n service. Keep optional-package types private;
  explicitly annotate public service returns so inference cannot leak them.
- Keep the raw base-instance runtime API; expose its structural translation,
  cloning and language-detection surface. Callers needing the complete vendor API
  can use an explicit `i18next.i18n` type assertion at that opt-in boundary.
- Preserve string-key translation calls, defaults and interpolation options.
  Do not promise string results for options requesting objects or details.
  The disabled/missing-peer fallback returns the last key from a key array,
  keeping that overload consistent with the string return contract.
- Compile a real installed tarball in the packaging smoke test with strict
  declaration checking, ordinary ambient dependency types, and absent i18n peers.
  Exercise the reported helper path and other core/public i18n surfaces.
- P1y's generated keys, selector support, runtime isolation and backend design
  remain queued; this patch supplies their dependency-free baseline only.

## Files

- `src/services/i18n/types.ts` (new), `I18n.ts`, `I18n.test.ts`
- `src/services/http/HttpServer.ts`, `src/services/http/types.ts`
- `src/services/validate/ValidateService.ts`
- `src/models/User.ts`, `src/models/UserOld.ts`
- `scripts/packaging-smoke-test.sh`, `scripts/fixtures/optional-i18n.mts` (new)
- `CHANGELOG.md`, this card, `.plans/refactor/README.md`,
  `.plans/refactor/active/i18n-default-values.md`,
  `.plans/refactor/queued/i18n-contracts-and-tooling.md`

## Verification

Demonstrate that the packed compilation fails with the original declarations,
then passes with the fix and both peers absent. Pin basic translation typing and
real i18next structural compatibility. Run `npm test`, `npm run check`, both
codegen/type gates sequentially with one checker and separate incremental caches,
and `npm run smoke`.

## Out of scope

Dependency promotions, ambient stubs, declaration-check suppression, generated
translation keys, selectors, namespace changes, runtime engine/backend redesign,
other optional integration entry points, release/commit/push, and unrelated edits.

## Done when

All five gates pass and the packed fixture reproduces the reported import chain
without resolving either i18n peer. Document the vendor-specific typing boundary,
move this card to done and update its index entry in the same working-tree change.

## Completed — September 11, 2026

Implemented the structural translation surface with explicit public return types;
the only remaining source import of i18next types is for private service fields.
The emitted core declarations have no mandatory i18next imports.

The original packed build, installed outside the repository with an
`appInstance`-only consumer, reproduced exactly the two reported TS2307 errors in
`HttpServer.d.ts` and `I18n.d.ts`. The fixed packed fixture verifies requests,
validation, modern/legacy user email arguments and service methods, plus negative
translation type assertions. Both peers are confirmed absent from the consumer
and the installed framework's resolution paths before compilation.

Verification:

- `npm test`: 838 passed, 0 failed.
- `npm run check`: passed; existing Biome schema-version informational notice.
- `npm run check:types -- --checkers 1 --incremental --tsBuildInfoFile node_modules/.cache/tsc/framework.tsbuildinfo`: passed.
- `npm run check:types:tests -- --checkers 1 --incremental --tsBuildInfoFile node_modules/.cache/tsc/tests.tsbuildinfo`: passed.
- `npm run smoke`: passed, including strict packed declaration checking and
  English runtime responses with neither i18n peer installed.

The test suite required local-socket permission for MongoDB/HTTP; packaging used
a temporary npm cache and permitted registry access. All changes remain
uncommitted, and pre-existing working-tree changes are preserved.
