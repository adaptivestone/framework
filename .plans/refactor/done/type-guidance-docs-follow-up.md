# Type guidance documentation follow-up

**Status:** done (2026-09-10).

## Goal and decisions

Update the public documentation for the completed type/runtime audit and measured local TypeScript 7 checking workflow. Keep the existing model API and schema-first guidance. Label fixes still under `Unreleased` explicitly; do not advertise the future simple-model API as available. Use only generic examples and avoid private project identifiers, paths and benchmark artifacts.

## Files

- This plan and `.plans/refactor/README.md` in the framework repository.
- Documentation repository: `docs/10-cli.md`, `docs/05-models.md`, `docs/06-Controllers/02-routes.md`, and generated `static/llm-context.md`.

## Scope

- CLI: single-checker local checks, distinct incremental caches, cold diagnostics, checker/thread distinction and CI measurement caveat; preserve codegen.
- Models: unreleased nested ID/schema-option/wrapped-override corrections, setter-only virtual semantics and known limitations.
- Routes: route-first then middleware validation output composition, shallow later-key precedence, optional-key typing, singleton non-object outputs and object-only combined/content-type contracts.

## Verification and done when

Check descriptions against the current implementation and regression fixtures. Build the documentation to regenerate LLM context and validate links; inspect rendered HTML for the added headings, examples and release notices. Check diffs and preserve existing staged work. The framework release gates already passed on the unchanged implementation; this follow-up changes documentation only. Move the plan to done and update the index after the documentation build succeeds.

## Out of scope

Framework source, package/config changes, API implementation, docs restructuring, unsupported release-version claims, publishing, commits and staging.

## Results

Updated the three guides and regenerated the ignored LLM context through the normal docs build. `npm run build` passed in 7.5 seconds; no broken-link errors. Rendered HTML contains the new headings, examples and unreleased notices, and the generated context contains all three guides verbatim. Documentation and framework diffs pass whitespace checks. No source/API/config changes, staging, commits or publishing. The documentation build emitted only the existing Node localStorage experimental warning.
