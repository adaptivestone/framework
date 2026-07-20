# P1u — Route-transparent controller groups

**Status**: 🟢 implemented 2026-07-20 · build/focused/smoke/docs green · awaiting `5.2.0`
**Target**: `5.2.0`, additive
**Depends on**: shared default controller-path helper used by runtime and AST codegen

## Goal

Allow controller files to be organized in parenthesized folders without adding those folders to
their URLs.

```text
controllers/(group)/Reports.ts          → /reports
controllers/(group)/admin/Settings.ts   → /admin/settings
```

## Delivered behavior

- A fully parenthesized folder segment is omitted from the default route prefix.
- Ordinary folders keep their current lowercased URL segments.
- One shared `controllerRoutePrefix` helper drives runtime and AST codegen path derivation.
- Generated `*.routes.gen.ts` files stay beside their source inside the organizational folders.
- If groups collapse two handlers onto the same method/path, boot fails through the existing route
  collision error instead of silently choosing one.
- Both POSIX and Windows folder separators normalize consistently.

## Files

- `src/modules/AbstractController.ts` — shared route-prefix normalization.
- `src/controllers/index.test.ts` — runtime mounts and collision coverage.
- `src/codegen/routeTypesDiscovery.test.ts` — AST paths and generated-file placement.
- Controller documentation and changelog.

## Out of scope

- Kebab-casing multi-word controller class names.
- Ignoring arbitrary folder naming patterns other than a fully parenthesized segment.
- Changing explicit `getHttpPath()` overrides.

## Verification

- Build, 103 focused tests, package-consumer smoke, formatting, and the documentation build pass.
- The full local run reached 677 passing tests and 6 skips. Its migration-suite hook timeout passed
  all 6 tests when rerun alone; the remaining 2 failures require a Redis service that was not
  available in the local environment.

## Done when

- Moving a controller into one or more route groups leaves `routes` CLI output unchanged.
- Runtime and generated request types resolve the same URL.
- Existing non-group folder behavior remains byte-compatible.
- Build, focused tests, full tests, packaging smoke, and documentation build pass.
