# Prepare framework 5.4.2

## Goal and decisions

Prepare the current Unreleased work as **5.4.2**, the patch version chosen by the
user on October 1, 2026 (same reasoning as 5.4.1: small additions, one flagged
consumer action). Preparation does not publish a package/site or create commits,
tags, pushes or a GitHub release.

## Files

- `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`.
- This card and `.plans/refactor/README.md`; move the shipped
  `later/vitest-to-node-test.md` card to `done/` (migration shipped in 5.3.0).
- Documentation repo: replace the "after 5.4.1" placeholders in `docs/10-cli.md`,
  `docs/06-Controllers/01-intro.md` and `docs/13-deploy.md` with 5.4.2.
- A reviewable package tarball outside Git.

## Work

1. Confirm npm latest is 5.4.1 and tag 5.4.1 is the baseline.
2. Bump only the root package versions; move Unreleased notes to dated 5.4.2 notes.
3. Synchronize README upgrade notes, roadmap status and docs version wording.
4. Run all five framework gates (TypeScript checks sequential, one checker,
   separate caches), the Bun suite and Bun packed consumer; rebuild docs.
5. Pack and inspect the 5.4.2 artifact.

## Out of scope

New features, source changes, further dependency upgrades, the example-project
update (after publication), publishing and git mutations.

## Done when

Version metadata and release notes agree on 5.4.2; all local checks pass; the
tarball has the intended version and contents; docs build; this card records the
results and moves to done.

## Verification results — 2026-10-01

- npm latest was 5.4.1; tag 5.4.1 is the baseline. The release content was
  already committed by the user as `ffd7836`; preparation only changed version
  metadata, notes, docs wording and plan status.
- Root manifests agree on 5.4.2; no dependency changes beyond those committed.
- Biome, main and test TypeScript checks (one checker, separate caches,
  sequential) passed.
- Node 26.9.0 suite: 852/852 passed, no skips. Packaging smoke passed.
- Bun 1.4.2 suite: 827/827 passed. Bun packed consumer passed boot, HTTP, real
  MongoDB CRUD, password hashing and clean shutdown with `SMOKE_REQUIRE_MONGO=1`
  against a disposable `mongo:8` container (removed afterwards).
- Documentation site built; generated LLM context includes the 5.4.2 wording.
- Local checks do not replace the remote Node/Bun CI matrix.

## Prepared artifact

- `adaptivestone-framework-5.4.2.tgz` (session scratchpad, outside Git).
- Version 5.4.2; 332,714 bytes; 391 archive entries — the same file list as the
  published 5.4.1. Source, tests, fixtures, scripts and plans are excluded.
- SHA-256: `4e691eb35f4cb9f3a79273147167a162ab35398c64c50e9c5f3558d6eeb6cc0d`.
- npm integrity: `sha512-4I5ZDe2WqVwugr3R/az4lSE/Ct148I8EhfnnCOXIngWSF3uCbMxczf8F7IBAhMEBQ5PmVjg7GGzsHYlIe8eNww==`.
- Inspected: package version 5.4.2, optional peer ranges (Sentry 10/11,
  oxc-parser ^0.152.0, vitest 4/5), `createuser --token` and
  `HttpServer.listen()` present in `dist`.

## Completion

Preparation complete. Changes remain in both working trees; no commit, tag,
push, package publication, site deployment or GitHub release was created. Next:
the user publishes, then the example project is updated.

## Publication

The user published 5.4.2 to npm on 2026-10-01 (checked 2026-10-03). The GitHub release was
not cut yet: the latest GitHub release is still 5.4.1.
