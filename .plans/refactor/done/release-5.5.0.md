# Prepare framework 5.5.0

## Goal and decisions

Prepare the Unreleased work as **5.5.0**, the minor scoped with the user on 2026-10-02/03:
the coded, translatable error contract (including middleware errors through the
registry), health endpoints, log redaction, `hashSecret`/`verifySecret`, canonical
rate-limit keys, CORS `exposedHeaders`, OpenAPI optional auth, config-type fixes and
`createEnv`. P1q, P1m and `bodyParsing` moved to 5.6, OpenAPI response contracts to 5.7,
and the `RequestParser` 413/400 migration to 5.6. Preparation does not publish a
package, tag or GitHub release.

## Files

- `package.json`, `package-lock.json` (root version only), `CHANGELOG.md` (dated
  5.5.0), `README.md` (5.5.0 upgrade notes).
- This card and `.plans/refactor/README.md`.
- Last-minute fix in the same PR: the reserved `bodyParsing` modes no longer promise
  v5.1 in their JSDoc (`AbstractController.ts`, `RouteNode.ts`).
- Documentation repo: nothing to change. Every 5.5 docs PR is merged and the pages
  already say "5.5"/"5.5.0".

## Verification results — 2026-10-03

- npm latest is 5.4.2 (published 2026-10-01); 5.5.0 is not published.
- Biome, main and test TypeScript checks (one checker, separate caches, sequential)
  passed.
- Node 26.9.0 suite: 923/923 passed, no skips. Packaging smoke passed.
- Bun 1.4.2 suite: 898/898 passed. Bun packed consumer passed boot, HTTP, real
  MongoDB CRUD, password hashing and clean shutdown with `SMOKE_REQUIRE_MONGO=1`
  against a disposable `mongo:8` container (removed afterwards).
- Documentation site at `main` (`90d7e61`) built; the generated LLM context includes
  the 5.5 wording.
- Local checks do not replace the remote Node/Bun CI matrix.

## Prepared artifact

- `adaptivestone-framework-5.5.0.tgz` (session scratchpad, outside Git).
- Version 5.5.0; 350,057 bytes; 409 archive entries. Compared with the published
  5.4.2 (391): 18 added (`.js`, `.d.ts`, `.js.map` of `commands/CreateEnv`,
  `config/health`, `controllers/Health` + its `routes.gen`, `helpers/objects`,
  `services/logging/redaction`), none removed. No source, tests, fixtures, scripts or
  plans included.
- SHA-256: `6cb7152f58636f7ab37b8eda7f74cf956635a9635754116e92375f4cfa111b63`.
- npm integrity: `sha512-i6Q0Mv4l2dBMWKSD3T3he8K1RvCUNRoFunsILZtpNU10xB2Kh6MEW5UrZgotH1IvmFHaoIo4r71R95MI9vCw2Q==`.

## Completion

Preparation complete. Next: the user publishes 5.5.0 to npm; then the GitHub release
(5.4.2's is also not cut yet), the example-project update, and the consumer
follow-ups (`createEnv` replaces an app's own ensure-env script).
