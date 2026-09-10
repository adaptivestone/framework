# Model type-cost experiments

**Status:** done (2026-09-10).

## Goal and decisions

Explain the remaining single-checker generic instantiation count and find a concrete way to reduce it without weakening schema-derived types. Use the prior private compiler snapshot as a fixed baseline, one bounded compiler at a time, and compare counts as well as timings. Generic instantiations are evaluations of type functions, not distinct user-defined types.

Perform representation and attribution experiments only in a private cloned snapshot. Prefer equivalent named interfaces or reusable intermediate model/schema types; any deliberately weakened diagnostic control must be labeled and cannot be shipped. Preserve raw/hydrated distinctions, ID corrections, overrides, schema options, methods, statics and query behavior. Source review may be delegated; compiler runs remain sequential. Public notes must stay generic, with all application names and raw diagnostics outside the repository.

## Files and artifacts

- This plan, `.plans/refactor/README.md`, and the follow-up note in `done/compiler-type-cost-investigation.md`.
- Read `src/modules/BaseModel.ts`, Mongoose declarations and model fixture tests.
- Private snapshot declaration variants, diagnostics and findings outside this repository.

## Verification and done when

Compare a bounded baseline against targeted variants; record compiler diagnostics and exact instantiation/type counts. Explain which costs are measured, identify any candidate improvement and its unresolved compatibility checks, and restore the private snapshot after experiments. No production/source implementation in this checkpoint. Any candidate implementation needs a separate scoped plan and all five framework gates.

## Out of scope

Publishing, commits, dependency upgrades, application source/settings changes, broad type rewrites, and shipping weakened model contracts.

## Results

- The 2,821,782 baseline figure counts generic-instantiation operations, not distinct types; the snapshot creates 460,457 types. The previous model declarations still required 2,711,004 instantiations on the same source/compiler/dependencies. Recent model corrections increased the count by about 4.1%, with almost unchanged reported memory.
- Equivalent representation experiments did not find a material improvement. Named Schema and Model interfaces increased counts to 4,784,559 and 3,560,468 respectively. An empty raw-correction fast path reduced counts by about 2.4%, without a meaningful memory reduction; explicit schema document generics and method-this inference reordering had negligible effects.
- Attribution controls: excluding tests reduced counts by about 3%; erasing schema method/model generics reduced less than 0.2%; disabling hydrated ID corrections reduced about 1.4%. Weakened controls were restored and are not proposed changes. The earlier schema-method trace locations therefore indicate triggers for inference needed elsewhere, not isolated removable cost.
- With one checker and incremental caching, a full successful run used 2,821,782 instantiations, 691,120 K reported memory and 10.843 s compiler time. An unchanged repeat passed with zero new instantiations, 181,041 K and 1.038 s. Changed-input invalidation was not measured; timings varied with system load.
- Recommendation: retain the correctness fixes, use one checker and persistent incremental caches, and require measured contract-preserving savings before refactoring type representations. No framework implementation or consumer compiler settings were changed. All private declaration experiments were restored and snapshot source/config/generated-file hashes verified. All compiler sessions completed or were bounded and cleaned up; no runtime gates were rerun for analysis only.
