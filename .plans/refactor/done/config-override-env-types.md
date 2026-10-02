# Config types: keep env keys spread from an overridden framework config

**Status**: ✅ implemented 2026-10-02; unreleased
**Release**: next minor `5.5.0` (fix)
**Origin**: consumer feedback — an app `config/auth.ts` of `{ ...originalAuth, … }` lost `saltSecret`
from the generated `getConfig('auth')` type whenever `AUTH_SALT` was unset at `generatetypes` time
(CI), and kept it as `string` where it was set: local type checks passed, CI failed (TS2339). The
workaround was `saltSecret: process.env.AUTH_SALT ?? ''`.

## Cause

Config types come from the runtime value; an `undefined` key is dropped unless the config's source
reads it from `process.env` ([config-schema-codegen](config-schema-codegen.md) env shape). When an
app overrides a framework config, the loader skips the framework file, so only the app file is
scanned — and the env read lives in the framework file, reached through the spread.

## Decision

- The loader reports overridden internal files (`getFilesPathWithInheritance` `onOverridden`); the
  server records the framework base config each app config replaces
  (`internalFilesCache.overriddenConfigPaths`). Runtime loading is unchanged.
- Codegen parses those files (source text only, no import) into a **fallback** env shape. Strict
  rule (maintainer): it fills ONLY keys whose runtime value is `undefined` and that the app's own
  source does not read from env. A key with a value keeps its value type (an app `saltSecret: 5000`
  stays `number`); keys absent from the value are never added.
- Result: `saltSecret: string | undefined` in every environment, as in the framework itself.

## Rejected

- Typing every unknown `undefined` key as `unknown`: forces casts and still flips with the
  environment (`string` when set). Possible later safety net for non-framework spreads.
- Following the spread's `import` in the AST: codegen is deliberately source-only without import
  resolution.

## Files

`src/helpers/files.ts`, `src/server.ts`, `src/codegen/appTypes.ts`, `src/codegen/index.ts`,
`src/codegen/appTypes.test.ts` + fixture `src/codegen/__fixtures__/config/authOverride.ts`,
`CHANGELOG.md`; docs repo `02-configs.md`.

## Verified

Unit tests (spread key kept; valued key keeps its type; no key invented) and an end-to-end
`generatetypes` run in a scratch app overriding `auth`, `AUTH_SALT` unset: before the fix the key is
missing, after it is `string | undefined`.
