# Prepare framework 5.5.1

## Goal and decisions

Prepare the [consumer review fixes](consumer-review-fixes.md) as **5.5.1**, the patch the user chose on 2026-10-06: the `Auth`/`Role` return-type regression and the `generateToken` stale-password race. Request-validation 400s through the registry is a behavior change, so it was split out to [validation-errors-registry](../queued/validation-errors-registry.md) for 5.6. Also left out: the older `ValidationError` declaration error under `skipLibCheck: false` (never assessed for this patch), now tracked in the same 5.6 plan. Dependencies, by the user's request: the optional `oxc-parser` peer and dev dependency move to `^0.153.0` (codegen output unchanged); `mongoose` 9.11.0 and `lefthook` 2.1.17 are lockfile-only. Preparation does not publish a package, tag or GitHub release.

## Files

- Fixes: `src/services/http/middleware/Auth.ts`, `Role.ts`, `src/models/User.ts`, `src/controllers/Auth.ts` and their tests (`AbstractMiddleware.test.ts`, `User.test.ts`, `Auth.test.ts`).
- `package.json` (version; `oxc-parser` ^0.153.0 in devDependencies and peerDependencies), `package-lock.json` (version, `oxc-parser`, `mongoose`, `lefthook`), `CHANGELOG.md` (dated 5.5.1; the 5.5.0 entry also amended: an app's own `controllers/Health.ts` replaces the built-in controller, and the `Role`/`RateLimiter` bodies gain an `error` field), `README.md` (5.5.1 upgrade notes).
- This card, the two plan cards above and `.plans/refactor/README.md`.
- Documentation repo: `docs/05-models.md` (what `generateToken` rejects with, since 5.5.1), `docs/13-deploy.md` (an existing `controllers/Health.ts` replaces the built-in one) and `docs/10-cli.md` (`oxc-parser` ^0.153.0).

## Verification results — 2026-10-06

- npm latest is 5.5.0 (published 2026-10-03); its integrity matches the 5.5.0 card.
- Biome, main and test TypeScript checks (one checker, separate caches, sequential) passed.
- Node 26.9.0 suite: 925/925 passed, no skips. Packaging smoke passed. Rerun after the dependency updates: the same results, 122/122 codegen tests, and `npm run gen` output byte-identical.
- Bun 1.4.2 suite: 900/900 passed. Bun packed consumer passed boot, HTTP, real MongoDB CRUD, password hashing and clean shutdown with `SMOKE_REQUIRE_MONGO=1` against a disposable `mongo:8` container (removed afterwards).
- Documentation site built; the generated LLM context includes the 5.5.1 wording.
- Local checks do not replace the remote Node/Bun CI matrix.

## Prepared artifact

- `adaptivestone-framework-5.5.1.tgz` (session scratchpad, outside Git).
- Version 5.5.1; 350,808 bytes; 409 archive entries, the same file list as the published 5.5.0. No source, tests, fixtures, scripts or plans included.
- SHA-256: `20a70085e59f486e1a9fe30d3d0a9d6aade9c98d782961deb792619ac7a01c9b`.
- npm integrity: `sha512-ia0m0QYM6KzVsLV6r8YWAdw9zAeqKRnzRGmQz9PA7b094QSp00I63+C8BLwVHzHEaKZ4nOZNl9gzvbpRFVFTVg==`.
- Inspected: package version 5.5.1 and `oxc-parser` ^0.153.0 in the packed manifest; `dist/models/User.js` rejects with `BadRequestError`; `dist/controllers/index.js` does not carry the held-back validation change.

## Completion

Preparation complete. Changes remain in both working trees; no commit, tag, push, package publication, site deployment or GitHub release was created. Next: the user publishes 5.5.1, cuts its GitHub release and pastes the two amended 5.5.0 bullets into the 5.5.0 GitHub release. The example project then moves to `oxc-parser` ^0.153.0.
