# Prepare framework 5.6.0

## Goal and decisions

Prepare the work merged after 5.5.1 (#76 review fixes, #77 validators at boot, #79 per-method route matching) as **5.6.0**. #77 is a behavior change under `### Changed`, and its PR named the next minor, so this is 5.6.0. The queued work labelled v5.6 (P1q, validation-errors-registry, async-middleware) moves to the next minor.

Dependencies, by the user's request on 2026-10-27: every package moves to the newest version its range allows (lockfile only, including Express 5.3.0, Mongoose 9.11.4, Sentry 11.9.0, i18next 26.5.11 and Biome 2.6.3). The optional `oxc-parser` peer and dev dependency move to `^0.156.0`; codegen output is byte-identical. The lockfile update closes all eight open Dependabot alerts (body-parser 2.4.0, qs 6.17.0, vite 8.3.5), and `npm audit` reports none. The framework does not call body-parser or qs itself.

Two fallouts are fixed:

- i18next 26.5 split its `t(key, defaultValue, options?)` overload in two, and `TranslationFunction` mirrors the split. Type checks also pass against i18next 26.4.2 and 26.0.1.
- Biome 2.6 formats Markdown. `biome.json` moves to the 2.6.3 schema. By the user's choice, the 48 reformatted `.md` files are a separate commit (`3ef9d69`) instead of a disabled Markdown formatter. That commit repairs the spots where the 2.6.3 formatter changed the rendered text.

The open CodeQL alert #3 (`js/insufficient-password-hash` on `hashToken`) is a false positive: the hashed values are 256-bit random tokens, as the code comment says. It should be dismissed on GitHub.

Preparation does not publish a package, tag or GitHub release.

## Files

- Commit `3ef9d69` on `release/5.6.0`: the Markdown reformat only.
- Working tree: `package.json` (version; `oxc-parser` ^0.156.0 in devDependencies and peerDependencies), `package-lock.json`, `biome.json` (schema 2.6.3), `src/services/i18n/types.ts`, `CHANGELOG.md` (dated 5.6.0, plus the `oxc-parser` and `TranslationFunction` entries), `README.md` (5.6.0 upgrade notes), this card and `.plans/refactor/README.md`. `release-5.4.2.md` carries a one-line publication note that was already in the working tree.
- Documentation repo: `docs/10-cli.md` (`oxc-parser` ^0.156.0), in the worktree `../framework-documenation-github-5.6.0` on the local branch `docs/5.6.0-oxc-parser` (from `origin/main`). The other 5.6.0 pages are already merged (docs #26, #29).

## Verification results — 2026-10-27

- npm latest is 5.5.1; 5.6.0 is not published.
- Biome, main and test TypeScript checks (one checker, separate caches, sequential) passed.
- Node 26.12.1 suite: 948/948 passed, no skips, with `REDIS_URI` set against a disposable Redis container. Packaging smoke passed.
- Bun 1.4.4 suite: 923/923 passed. The Bun packed consumer passed boot, HTTP, real MongoDB CRUD, password hashing and clean shutdown with `SMOKE_REQUIRE_MONGO=1` against a disposable `mongo:8` container. Both containers were removed afterwards.
- `npm run gen` output with `oxc-parser` 0.156.0 is byte-identical to 0.153.0 (21 generated files).
- Every reformatted Markdown file was rendered with markdown-it before and after. The text is identical except for the CHANGELOG code-span repair and looser list spacing in `CHANGELOG_V2.md` / `CHANGELOG_V3.md`.
- The documentation site was not rebuilt for the one-sentence change.
- Local checks do not replace the remote Node/Bun CI matrix.

## Prepared artifact

- `adaptivestone-framework-5.6.0.tgz` (session scratchpad, outside Git).
- Version 5.6.0; 355,327 bytes; 409 archive entries, the same file list as the published 5.5.1. No source, tests, fixtures, scripts or plans included.
- SHA-256: `11e568fc31a3750b608b4aa35bbf04718cb196b11f03b89c0fb0cdb1d8db04a1`.
- npm integrity: `sha512-Tae9B6wxrQqXu/4OfPZZ8yqMoqgR76MIxDHk4GHVDGB9K4fCD7dUZCg4BxbzoLkgM9QXVTlsAGwFISA3caqPIA==`.
- Inspected: version 5.6.0 and `oxc-parser` ^0.156.0 in the packed manifest; `dist/services/i18n/types.d.ts` carries the split overloads.

## Completion

Preparation complete. At the user's request on 2026-10-27, Claude commits the release, merges the release and docs PRs, dismisses CodeQL #3, and creates the `5.6.0` tag and GitHub release. The user publishes 5.6.0 to npm. The example project then moves to framework ^5.6.0 and `oxc-parser` ^0.156.0.

**Published 2026-10-27**: release PR #80 merged, GitHub release `5.6.0` (21:16 UTC) and npm `5.6.0` (21:21 UTC), checked 2026-10-31.
