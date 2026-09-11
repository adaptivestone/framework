# Type/runtime parity audit fixes

**Release target**: 5.4.1, prepared 2026-09-11. Publication is a separate human step.

**Status:** done (2026-09-09); unreleased, left in the working tree for human review.
**Depends on:** shipped model typing and AST codegen. Independent of the queued response/middleware v2 contracts.

## Goal

Fix the six reproduced type/runtime mismatches without replacing schema-first inference or changing middleware execution order.

## Decisions

- Correct nested IDs recursively in all inline object/array spellings, retain explicitly declared `_id` paths, and carry wrapper `_id: false` into array elements. Preserve hydrated subdocument APIs.
- Apply raw/hydrated field overrides equally inside bare and wrapped arrays.
- Thread effective schema options through Mongoose inference; honor custom `typeKey` throughout the correction/override walkers and timestamp definitions, and ensure top-level `_id: false` cannot promise an ObjectId.
- Setter-only virtual reads include `undefined`; setters stay writable even when virtual definitions use `as const`. Getter output remains authoritative for get/set pairs. TypeScript mapped properties cannot express separate read/write types, so a setter-only property uses `V | undefined`.
- Preserve a single validator output as-is, including arrays/primitives/null. Multiple outputs retain the established ordered shallow merge for plain objects; incompatible non-object combinations fail explicitly instead of silently corrupting values. A content-type discriminator requires a plain object output.
- Generated request/query types include middleware validation outputs in runtime order (route first, middleware next). Later required keys replace earlier keys; later optional keys preserve the earlier possibility. Replace validated base slots rather than intersecting them with `Record<string, unknown>`. Preserve other middleware `provides` and request context fields.
- Add exact-type fixtures and runtime regressions before fixes. Parent reviews delegated model changes and runs complete verification.

## Files

- `src/modules/BaseModel.ts`
- `src/models/__fixtures__/nestedPathIds.ts`, `tsTypeOverride.ts`, `virtualShapes.ts`, new `schemaOptions.ts`
- `src/models/__fixtures__/nestedWorkflowModelPatterns.ts`
- `src/models/ModelTyping.typecheck.test.ts`, new `src/models/ModelTyping.runtime.test.ts`
- `src/controllers/index.ts`, `src/controllers/index.test.ts`
- New `src/services/validate/mergeValidatedOutputs.ts` and `.test.ts`
- `src/services/http/types.ts`, `src/codegen/emit.ts`, `src/codegen/emit.test.ts`
- `src/codegen/astExtract.ts`, `src/codegen/astExtract.test.ts`
- New `src/codegen/__fixtures__/controllers/ValidationComposition.ts` and `src/codegen/__fixtures__/middleware/ValidationOutputs.ts`
- `src/codegen/routeTypes.golden.test.ts`, related codegen expectation tests if needed
- `CHANGELOG.md`, this plan, `.plans/refactor/README.md`, and the historical `done/model-typing-seam-fixes.md` follow-up status

## Verification

Exact-type model/route fixture gates and targeted runtime tests; then `npm test`, `npm run check`, `npm run check:types`, `npm run check:types:tests`, and `npm run smoke`.

## Completed and verified (2026-09-09)

- All six findings are fixed with paired runtime and compile-time regression coverage. Custom-key array elements and nested `toObject()` raw overrides are covered as well.
- Raw correction resolves schema shapes before mapping document types to avoid recursive generic instantiation. Disabled hydrated IDs read as `undefined`; an optional raw marker prevents lean helpers from reintroducing ObjectId. Explicit IDs remain intact.
- HTTP coverage includes ordered required/optional merges, nullable middleware schemas, static/legacy fallback selection, unknown singleton outputs, content-type correlation, and nullish query metadata.
- `npm test`: **817/817 passed**, 52.2 seconds, with compile gates and coverage.
- `npm run check`: passed (existing Biome schema-version informational message only).
- `npm run check:types`: passed, 6.6 seconds.
- `npm run check:types:tests`: passed, 4.8 seconds.
- `npm run smoke`: passed, 14.1 seconds; built, packed, installed, and exercised a scratch consumer.
- Focused model fixtures and generated-route fixtures passed in 7.0 and 3.5 seconds respectively. Model runtime/helper tests and seven controller integration regressions also pass.
- Final independent review found no confirmed defect. Its suggested custom-key raw/lean/Lite assertions were added; the complete model fixture gate passed again in 6.7 seconds and the changed fixture passed Biome.
- Validation logs are in `/tmp/framework-parity/`. `run.py` bounds process groups and `typecheck.py` bounds individual compilers; failed diagnostic snapshots in that directory are superseded by the current source. No commits or pushes were made.

## Out of scope

Configuration-generation redesign, projection typing, query helpers, hook typing, HTTP response descriptors, async middleware v2, new validation ordering, and commits/pushes.

## Done when

All six audit findings have passing regression coverage, full gates pass, and this plan is moved to done with the index and changelog updated.
