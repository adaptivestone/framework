# P2a-fix — Resilient OpenAPI request-schema conversion

**Status**: 🟢 implemented 2026-07-20 · build/focused/smoke/docs green · awaiting `5.2.0`
**Target**: `5.2.0`, additive/fix
**Depends on**: shipped OpenAPI generator and `ValidatorDriver.toJsonSchema`

## Goal

One validator construct must not abort the complete OpenAPI export. Zod request schemas should
describe their input shape, including transformed values and the framework's HTTP date convention.

## Delivered behavior

- Zod export uses draft 2020-12 with `io: 'input'` and `unrepresentable: 'any'`.
- `z.coerce.date()` is documented as `{ type: 'string', format: 'date-time' }`.
- Other unrepresentable Zod inputs degrade to `{}` instead of throwing.
- Every schema conversion is contained independently. A thrown exporter produces a contextual
  warning; request bodies receive the existing placeholder and query parameters are omitted.
- A genuine boot, generator, or file-write failure still rejects and the CLI exits non-zero through
  the already-shipped command failure path.

## Files

- `src/services/validate/drivers/StandardSchemaDriver.ts` + tests.
- `src/services/documentation/OpenApiGenerator.ts` + tests.
- OpenAPI documentation and changelog.

## Out of scope

- Fabricating precise schemas for arbitrary custom checks or `instanceof` values.
- Response-body contracts; those follow universal responses in v5.3.
- Changing runtime validation/coercion.

## Verification

- Build, 103 focused tests, package-consumer smoke, formatting, and the documentation build pass.
- The full local run reached 677 passing tests and 6 skips. Its migration-suite hook timeout passed
  all 6 tests when rerun alone; the remaining 2 failures require a Redis service that was not
  available in the local environment.

## Done when

- Transforms export their input schema and coerced dates export as date-time strings.
- An unrepresentable/custom schema cannot prevent healthy routes from appearing in the document.
- Warnings identify the affected method/path/schema position.
- Build, focused tests, full tests, packaging smoke, and documentation build pass.
