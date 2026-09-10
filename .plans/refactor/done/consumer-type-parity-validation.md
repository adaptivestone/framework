# Consumer compatibility validation

**Status:** done (2026-09-10). Local adoption and compatibility assessment completed; the build remains unpublished.

## Goal and decisions

Validate the unpublished type/runtime parity changes against an existing consumer backend. Capture the installed baseline, build and pack this checkout, then install the tarball locally without changing the consumer's registry dependency or lockfile. A later `npm ci` will restore the registry build until these fixes are published.

Keep both repositories' existing work intact. Address only compatibility regressions introduced by this upgrade, without widening types or copying model interfaces. Run bounded compiler checks and save anonymized checkpoints here and application-specific details outside this repository. Tests must use local disposable MongoDB or an explicitly verified local Atlas test instance.

## Files and artifacts

- This plan and `.plans/refactor/README.md`.
- Local build/tarball and test logs under `/tmp/framework-parity/`.
- The consumer's installed framework and regenerated ignored type artifacts.
- Any source regression fix must be listed here before implementation.

## Verification

Compare baseline and upgraded `npm run check:types` and `npm run check`; run model/controller tests and the full consumer suite where local services support it. Confirm installed package contents match the tarball, dependency lock/manifest are preserved, and report any unrelated failures separately. Framework changes, if needed, require its five standard gates.

## Out of scope

Publishing, deployment, commits/pushes, framework simplification, unrelated consumer refactoring, and production data access.

## Done when

The local framework build is installed in a consumer application, compatibility is assessed with concrete check results, and any remaining environmental or pre-existing failures are identified.

## Results (2026-09-10)

- Installed the current packed build and verified all 388 package files against the tarball. Dependency and peer requirements match the previous package. Registry metadata was unavailable, so the backed-up installed package was replaced directly. The manifest and lockfile were not changed by this task.
- Regenerated application and route types successfully. The final `tsc --noEmit --extendedDiagnostics` passed in 54.2 seconds wall time, with 38.5 seconds compiler time and about 1.7 GB memory use. Earlier bounded runs of both old and new packages timed out while local services competed for resources; the final run passed after disposable services were removed.
- `npm run check` passed across 214 files with one warning in concurrent application edits and two informational notices.
- Full runtime suite: **229/230 passed**, 63 suites, no skipped or cancelled tests. All five model suites passed. One search-result assertion failed under full-suite load; the identical focused seven-test suite then passed with both the previous and current package. The intermittent full-suite failure remains unexplained; no reproducible framework regression was found.
- Runtime tests used a fresh local Atlas database and mail catcher. All task-created containers, network, and three volumes were removed afterward.
- The consumer's native dependencies changed from Linux to macOS between sessions, so final checks used the matching host runtime. Existing application edits were preserved. Application names, paths, detailed diagnostics, and recovery notes remain outside the public repository.
- No additional framework source changes were needed. The earlier type/runtime parity implementation retains its recorded five passing framework gates. No commits, pushes, publishing, or deployment were performed.

A later consumer `npm ci` restores the registry package until the local fixes are published. Runtime verification should retain the reported intermittent search-test caveat.
