# Independent model contract prototype

**Status:** done (2026-09-10); private prototype only.

## Goal and settled scope

Measure whether a concrete generated record contract and a small persistence API can keep Mongoose's type graph out of application checking. Retain Mongoose at runtime. Use one generic nested workflow model based on the existing regression fixture, entirely in a private scratch directory. This is a bounded architecture experiment, not a replacement of the shipped schema-first API.

Compare full model access, an adapter checked in the same compilation, and an emitted declaration boundary. Report the adapter's separate checking cost, compiler input scope, and lost API capabilities explicitly. Generate concrete record declarations from the isolated runtime schema; support only the fixture's field kinds and reject unsupported shapes. Keep optionality conservative for stored lean records. Preserve BSON IDs, dates, nested array IDs and disabled IDs. Check schema generation, positive/negative typing, and runtime query/output behavior without starting application services.

## Files and artifacts

- This plan and `.plans/refactor/README.md` only in the repository.
- Read `src/modules/BaseModel.ts`, `src/models/__fixtures__/nestedWorkflowModelPatterns.ts`, and existing model parity plans/tests.
- Private scratch model, generator, generated contracts, adapter, application fixtures, bounded benchmark runner, diagnostics, tests and report outside the repository.

## Verification and done when

Run one bounded compiler at a time using the prior compiler/dependency versions and settings. Record diagnostics for identical operations across the compared surfaces; verify the declaration-only application excludes Mongoose and framework declarations. Type-check the adapter without unchecked return casts. Run relevant runtime and negative type checks, record limitations and a go/no-go recommendation, and leave a recoverable checkpoint. Run the five repository verification gates before closing the checkpoint, as required by AGENTS.md.

## Out of scope

Production source/settings changes, full application migration, arbitrary fluent queries/population/plugins, a general-purpose generator, projection typing, framework release, dependency installation/upgrades, commits and publishing. No private application identifiers or paths in repository artifacts.

## Results and decision

- Built an executable one-model prototype: runtime-schema generation of concrete read/create interfaces, a five-operation persistence adapter, equivalent native/application scenarios, and positive/negative contract checks. The adapter keeps Mongoose at runtime and type-checks without unchecked return casts. Read contracts account for missing defaults and nullable array elements; creation deliberately accepts a stricter subset of native casting inputs.
- Three cold repetitions per case, one checker, same dependencies: full-model source required 721,163 instantiations; the small API in the same program required 725,555. A wrapper alone provided no reduction.
- Fair emitted-declaration comparison: full-model application checking required 566,802 instantiations and median 246,234 K reported memory; the independent contract required 270 and 51,407 K. Median compiler totals were 0.741 s and 0.051 s. These are fixture-scale observations, not whole-project speedup estimates.
- The adapter separately requires 725,289 instantiations. Its work remains during complete rebuilds; combined cold checking did not reduce instantiation work. The benefit is isolating routine application checking from model compilation. Input manifests confirm no Mongoose/framework declarations or model/adapter source enter the independent application compilation.
- Build, generation freshness, positive/negative type fixtures, and all five runtime tests pass. Runtime tests use real Mongoose with native collection test doubles; they verify matching results/calls, defaults/IDs, lean/null behavior, validation and missing records. No live database integration was tested. All 15 bounded measurement runs completed; private source, logs, input hashes and a recovery checkpoint are saved.
- Decision: viable as a small separately compiled contract boundary, not a drop-in replacement for all model types. The prototype generator is limited to its fixture and does not recover phantom overrides or support arbitrary plugins/schema features. Its runtime schema loading is confined to scratch experiments; production generation must preserve the settled zero-init/import-free model scan. Any production migration needs a separate scoped plan and full release gates. No framework implementation, consumer settings or dependencies changed; no commits or staging.

## Repository verification

All five required gates passed: `npm test` (817/817 tests, 208 suites), `npm run check`, `npm run check:types`, `npm run check:types:tests`, and `npm run smoke`. The test suite required local socket access for its disposable database; the initial sandbox startup refusal was resolved by the permitted rerun. These framework checks supplement the separate prototype checks above. Generated tracked files and the pre-existing staged diff remain unchanged.
