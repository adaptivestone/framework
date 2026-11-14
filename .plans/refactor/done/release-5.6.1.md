# Prepare framework 5.6.1

## Goal and decisions

Prepare **5.6.1** (the user chose a patch, 2026-11-14) from:

- the [5.6.0 review fixes](review-5.6-fixes.md) already in the working tree;
- a consumer's 5.6.0 issue report (two issues, assessed below);
- a consumer request to parse `application/csp-report` as JSON, built as the
  [request media-type map](request-media-types.md);
- every dependency updated, by the user's request.

The working tree carries `### Changed` and `### Added` entries. Earlier releases
took a minor for those. The user chose 5.6.1 because they are fixes in nature and
5.7 is kept for the HTTP response work.

### Consumer issue 1: test databases survive teardown

Confirmed. 5.6.0 emitted `shutdown` (which force-closes every Mongoose
connection) before dropping, and swallowed the drop error; the review fixes
already reordered drain → drop → shutdown. Two gaps remained and are fixed in
`stopTestServer`:

- Compiled models create their collections in the background (`autoCreate`). A
  build still running after the drop recreated the database. Teardown now
  awaits every model's `init()` (`Promise.allSettled`) before dropping.
- A drop error was swallowed. The drop now runs only on an open connection
  (`readyState === connected`), and its error propagates after
  `shutdown`/`disconnect` run in a `finally`.

Not taken: `mongoose.set('autoCreate', false)` in the test setup. It would make
tests create capped, time-series and clustered collections as plain ones on
first insert, so tests would no longer match production.

Regression: `testBootstrapServer.ts` compiles a model right before teardown and
slows its collection build by one second. With the fix the build is fulfilled
and the database is gone; without the wait the build is rejected after
Mongoose's 10 s buffering timeout. (Mongoose resets `Model.$init` when the
connection closes, so the fixture keeps the compile-time promise; its patched
`$init.catch` is not usable after the reset, hence `Promise.allSettled`.)

### Consumer issue 2: peer ranges block updates

Confirmed: for 0.x, `^0.156.0` is 0.156.x only, and `i18next` 27 was outside
`^26.0.1`.

- `oxc-parser`: `>=0.156.0 <1` (user's choice over an explicit list that needs
  a release per weekly minor). Codegen uses only `parseSync(file, source)` →
  ESTree; output with 0.158.0 is byte-identical to 0.156.0 (20 generated files).
- Not taken: making `oxc-parser` a regular dependency. It reverses the 5.3.0
  decision to keep the native codegen-only binary out of production installs;
  codegen ships in the same package, so there is no separate CLI package to
  depend on it.
- `i18next`: `^26.0.1 || ^27.0.0`. The framework sets `fallbackLng` from
  config, has no empty translations, and checks languages against
  `supportedLngs`, so 27's default changes do not affect framework messages.
  27 types `t(key)` and `t(key, options)` separately, so an i18next 27 instance
  no longer fit `TranslationFunction` (the public structural contract tested in
  `I18n.test.ts`). `TranslationFunction` mirrors the split, as 5.6.0 did for
  26.5. A double cast at the internal assignment was tried and rejected: it hid
  the error from the framework build while consumers assigning an instance to
  `TI18n` would still fail. Two internal callers pass options conditionally.

### Dependencies

All packages at the newest version their range allows (lockfile), including
Mongoose 9.12.1, Sentry 11.12.0, rate-limiter-flexible 11.4.1, vitest 5.1.0,
@redis/client 6.3.1 and Biome 2.6.7. Dev ranges: `oxc-parser` ^0.158.0,
`i18next` ^27.1.1. `npm audit`: only the known low `deepmerge` advisory (no
patched version; config objects only, see the review card).

Biome 2.6.7 formats Markdown differently (blank lines only: 34 added, 4
removed in 19 files). `biome.json` moves to the 2.6.7 schema. Every reformatted
file renders identically with markdown-it 14.1.0. Following the house rule,
the format-only files belong in their own commit.

## Files

- Teardown: `src/tests/setupFramework.ts`, `src/tests/fixtures/testBootstrapServer.ts`.
- Media types: see [request-media-types](request-media-types.md).
- i18n: `src/services/i18n/types.ts`, `src/services/i18n/I18n.ts`,
  `src/services/validate/ValidationError.ts`.
- Release: `package.json` (version, dev ranges, peer ranges), `package-lock.json`,
  `biome.json`, `CHANGELOG.md` (dated 5.6.1), `README.md` (5.6.1 upgrade
  notes), this card, `review-5.6-fixes.md`, `.plans/refactor/README.md`.
- Format-only (Biome 2.6.7): `docs/codegen-ast-approach.md`,
  `.plans/refactor/_archive/REFACTOR_PLAN_v1.md`, `.plans/refactor/active/llm-skills.md`,
  `.plans/refactor/later/static-middleware-cutover.md`,
  `.plans/refactor/reference/decisions.md`, and in `.plans/refactor/done/`:
  `boot-route-tree-log.md`, `coded-http-errors.md`, `codegen-mvp.md`,
  `codegen-zero-init.md`, `error-handler-registry-implementation.md`,
  `rate-limiter-lazy.md`, `runtime-validators.md`, `test-helpers.md`,
  `type-contracts.md`, `vitest-to-node-test.md`, `yup-optional.md`.
- Documentation repo: worktree `../framework-documenation-github-5.6.1`, local
  branch `docs/5.6.1` from `origin/main`: `06-Controllers/01-intro.md`,
  `02-routes.md`, `03-middleware.md` (mediaTypes; the RequestParser
  "No parameters" claim was wrong), `08-i18n.md` (i18next 27, `t` split),
  `09-testsing.md` (teardown), `10-cli.md` (oxc range). Site build passes.

## Verification results — 2026-11-14

- npm latest is 5.6.0; 5.6.1 is not published.
- Node 26.13.1 suite: 981/981 passed, no skips, with `REDIS_URI` set against a
  disposable Redis container.
- Biome, main and test TypeScript checks (one checker, separate caches,
  sequential) passed. Main and test type checks also pass against i18next
  26.0.1 and 26.7.2 (installed temporarily), with the i18n and validation
  tests green on each.
- Packaging smoke passed.
- Bun 1.4.4 suite: 955/955 passed. The Bun packed consumer passed boot, HTTP,
  real MongoDB CRUD, password hashing and clean shutdown with
  `SMOKE_REQUIRE_MONGO=1` against a disposable `mongo:8` container. Both
  containers were removed afterwards.
- `npm run gen` output with `oxc-parser` 0.158.0 is byte-identical to 0.156.0.
- The teardown regression fails without the model-build wait and passes with it;
  the 5.6.0 teardown order also fails it.
- Local checks do not replace the remote Node/Bun CI matrix.

## Completion

Preparation complete. At the user's request on 2026-11-14, Claude committed the
work on `release/5.6.1` (the Biome 2.6.7 Markdown reformat in its own commit),
pushed it and opened the release PR and the docs PR (`docs/5.6.1`). No tag, npm
publication or GitHub release; the release follows later. The consumer then
updates and adds `mediaTypes: { 'application/csp-report': 'json' }` to its own
`config/http.ts`.

Follow-ups discussed, not in this release: replace `deepmerge` with an internal
config merge helper (removes its advisory from consumers' `npm audit`), and make
Node 26 the floor in v6 (Node 24 is maintenance LTS until 2028-04-30).
