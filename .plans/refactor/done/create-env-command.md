# `createEnv` CLI command

**Status**: ✅ implemented 2026-10-02; unreleased
**Release**: next minor `5.5.0` (additive)
**Origin**: consumer feedback — apps carried their own `scripts/ensure-env.ts` so a fresh clone
boots: the framework fails fast without `AUTH_SALT`, and the hint was to paste a value from
`generateRandomBytes` by hand. Precedent: Laravel's `key:generate`.

## Decision

- `src/commands/CreateEnv.ts` (`npm run cli createEnv`, case-insensitive like every command).
- `.env` exists → no-op (never overwrite secrets). Otherwise copy `.env.example` (if any) and
  replace its `AUTH_SALT=` line with 32 random bytes as hex, or append the line; write with `wx`
  so a concurrently created `.env` is never overwritten.
- Paths are relative to the working directory, where the framework loads `.env`.
- The secret is never printed or logged.

## Not done

The second chore in the same feedback (`mongodb-memory-server`'s binary download in production
installs, caused by its optional-peer declaration making it `devOptional`) was left as is by the
maintainer; apps keep `MONGOMS_DISABLE_POSTINSTALL=1`.

## Files

`src/commands/CreateEnv.ts` (+ test), `CHANGELOG.md`; docs repo `10-cli.md`, `01-intro.md`,
`02-configs.md`.
