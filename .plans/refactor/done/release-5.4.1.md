# Prepare framework 5.4.1

## Goal and decisions

Prepare the current post-5.4.0 fixes as **5.4.1**, the patch version explicitly
chosen by the user on September 11, 2026. Include the current Unreleased entries
and the existing optional oxc-parser peer range update. Keep type compatibility,
password-policy, cache and rate-limit rollout notes visible. Preparation does not
publish a package/site or create commits, tags, pushes or a GitHub release.

## Files

- `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`.
- `src/modules/BaseModel.ts`: formatting-only adjustment required by the
  repository's updated Biome dependency; no type or runtime change.
- `src/controllers/Auth.test.ts`: construct auth schema fixtures in `before()`
  after app setup on both runners; Bun exposed eager construction with no app.
- This card and `.plans/refactor/README.md`.
- Move the shipped i18n-default-values, email-templates-v2 and
  bun-runtime-support cards from `active/` to `done/`; update their status and
  references in `queued/i18n-contracts-and-tooling.md` and
  `done/optional-i18n-declarations.md`.
- Label `done/model-typing-seam-fixes.md`, `done/type-runtime-parity.md` and
  `done/security-review-fixes.md` with the prepared 5.4.1 release target.
- Documentation repo: `docs/05-models.md`, `docs/06-Controllers/02-routes.md`,
  `docs/06-Controllers/03-middleware.md`, `docs/08-i18n.md`, `docs/10-cli.md`,
  `docs/11-cache.md`, and generated `static/llm-context.md`.
- A reviewable package tarball and validation logs under `/tmp`, outside Git.

## Work

1. Verify the published baseline and compare the current branch with tag 5.4.0.
2. Bump only root package versions; move Unreleased notes into dated 5.4.1 notes.
3. Synchronize the roadmap, shipped plan status and docs version requirements.
4. Run all five framework gates, with the main/test TypeScript checks sequential
   and using one checker plus separate caches. Run the available Bun suite and
   packed MongoDB consumer, and rebuild docs/LLM context.
5. Pack and inspect the final 5.4.1 artifact; leave it ready for human release.

## Out of scope

New features, unrelated source changes, further dependency upgrades, v5.5/v6
design activation, performance claims, remote CI dispatch, and publishing/git
mutations. Preserve existing documentation edits and the untracked security card.

## Done when

Version metadata and release notes agree on 5.4.1; all required local checks pass;
the tarball has the intended version and declaration fix; release docs build;
this card records results and moves to done. Distinguish local runtime checks
from the remote Node/Bun CI matrix, which preparation does not run.

## Verification results — 2026-09-11

- npm reports latest 5.4.0; local tag 5.4.0 is the comparison baseline.
- Root manifests now agree on 5.4.1, with no additional dependency changes.
- Main and test TypeScript checks passed with one checker and distinct caches.
- Biome passed after its one required formatting adjustment.
- Final Node 26.8.1 suite passed 838/838, with no failures or skips. An earlier
  rerun hit connection resets in Redis cleanup; no Redis container was running
  when inspected. The final run used a disposable Redis 7 container on a separate
  local port through `REDIS_URI`, without changing framework cleanup code.
- Packed Node consumer passed strict declaration checks with neither i18n peer
  installed and served English successfully.
- Six release guides built successfully, with generated LLM context and rendered
  release notices/links verified.
- Initial Bun run found ten auth schema tests constructing a controller before
  the app setup hook ran. Moved that fixture to `before()`; the complete final
  Bun 1.4.2 suite passed 813/813. Lint and test TypeScript checks passed again
  after this fixture correction.
- Bun's packed consumer passed boot, HTTP, real MongoDB CRUD, password hashing
  and clean shutdown with `SMOKE_REQUIRE_MONGO=1`; no database step was skipped.
- Local checks do not replace the remote Node/Bun floor/latest CI matrix.

## Prepared artifact

- `/tmp/framework-release-5.4.1/adaptivestone-framework-5.4.1.tgz`
- Version 5.4.1; 328,483 bytes; 391 archive entries.
- SHA-256: `8f0f098da3308170ec1eed872538b15665e2aa3c5d0411b2f192b5afae21b9b0`.
- Inspected the actual archive: optional peer metadata is intact, core
  declarations contain no mandatory i18next imports, dependency-free translation
  declarations are included, and package/release versions agree. Source,
  scripts and plans are excluded. npm's integrity value matches the archive.
- Framework verification logs: `/tmp/framework-release-{types,test-types,check,smoke,bun-tests,bun-smoke}.log`
  and `/tmp/framework-release-tests-isolated-redis.log`.
- Documentation build log: `/tmp/framework-release-docs.log`; rendered release
  notices, i18n anchors and the generated LLM context were checked.

## Completion

Release preparation is complete. The package, changelog, documentation and plan
status are ready for review. Changes remain in both working trees; no commit,
tag, push, package publication, site deployment or GitHub release was created.
