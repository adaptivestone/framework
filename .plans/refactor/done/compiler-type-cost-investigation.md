# Compiler type-cost investigation

**Status:** done (2026-09-10).

## Goal and decisions

Identify the causes of high type-checking time and memory using one bounded compiler trace and targeted diagnostic comparisons. Preserve the schema-first model design and all current typing guarantees. This checkpoint is measurement and analysis only; any implementation follows a separately scoped plan.

Use a private source snapshot to avoid changing an active consumer workspace. Keep compiler version, dependencies, source input, and compiler settings recorded with the measurements. Run one compiler at a time with process cleanup and bounded memory/time. Keep raw traces, application-specific findings, and paths outside this public repository; public results must use generic descriptions.

## Files and artifacts

- This plan and `.plans/refactor/README.md`.
- Private snapshots, trace/profile files, and analysis under a temporary directory outside the repository.
- Read relevant model and HTTP type helpers; no source edits.

## Verification and done when

Record compiler exit status and diagnostics; identify the dominant operations and affected type relationships from the trace, distinguishing measured findings from hypotheses. If useful, compare checker concurrency on identical input. Deliver a concise diagnosis and the next bounded optimization target. Confirm no source or dependency changes were made.

## Out of scope

Type simplification, changing public APIs or inference, application fixes, commits, publishing, deployment, and a broad performance rewrite.

## Results

- A private snapshot reproduced expensive structural comparisons of full Mongoose model/schema/method types. Completed trace spans identify schema-method access and typed method calls as concrete optimization targets; sampled allocation stacks primarily pass through structural type comparison.
- In paired profiled runs with a 2 GiB soft Go memory budget, four checkers used 1,784,360 K reported memory and 8,939,368 generic instantiations; one checker used 683,340 K and 2,821,782. Full type checking passed in both. This is approximately 62% less reported memory and 68% fewer instantiations with one checker.
- Compiler time was 41.5 s versus 5.1 s in that pair. Unprofiled follow-ups with a 3 GiB budget produced a four-checker timeout at 90 s and a successful one-checker run in 22.0 s at 681,938 K. Timings are load-sensitive diagnostic samples, not statistical benchmarks. The protective memory budget may amplify GC pressure.
- Trace finalization exceeded its time bound after successful checking. Complete events support expression-level attribution, but the unfinished type dictionary prevents decoding exact type-ID relationships. Separate CPU/memory profiles completed; profile shutdown contributes additional GC time beyond compiler time.
- Recommended next step: trial `--checkers 1` before changing type helpers. A separately scoped optimization should investigate schema-method access and full-model/authoring-model signature comparisons while preserving inference guarantees.
- Source/config/generated-file hashes in the snapshot were unchanged. No framework or consumer source, dependency, or compiler-setting edits were made. Raw traces and application-specific details remain outside this repository. No runtime/test gates were rerun for this analysis-only checkpoint.

## Follow-up

[Model type-cost experiments](model-type-cost-experiments.md) refine the hotspot interpretation: erasing schema method/model generics in a private attribution control reduced total instantiations by less than 0.2%, so the expensive accesses trigger work also required elsewhere. The previous model declarations already account for most of the cold workload. Persistent incremental checking complements the single-checker recommendation; an unchanged repeat reused results with zero new generic instantiations.
