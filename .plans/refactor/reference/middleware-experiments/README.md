# Middleware experiments

Scripts behind the numbers in [middleware-design-proposals](../middleware-design-proposals.md) and
[middleware-flow-models](../middleware-flow-models.md), kept as they were run (lint disabled per
file). Run from the repository root with Node ≥ 24 (results were taken on Node 26.12.1) or Bun.

| Script                         | What it shows                                                                      | Run                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `als-today.ts`                 | AsyncLocalStorage from a middleware with today's real `ExpressAdapter`             | `node <dir>/als-today.ts` · `bun <dir>/als-today.ts`                          |
| `als-stages.mjs`               | AsyncLocalStorage options in a stages runner, 40 concurrent requests               | `node <dir>/als-stages.mjs`                                                   |
| `als-cost.mjs`                 | Time and memory of one framework-owned store per request                           | `node --expose-gc <dir>/als-cost.mjs`                                         |
| `retained-memory.mjs`          | Retained heap per pending request for each runner model (A, B, C1, C2, C2W, D, H)  | `node --expose-gc <dir>/retained-memory.mjs <model> 10 2 10000 [timing\|als]` |
| `dispatch-bench.mjs`           | CPU cost of dispatch per model, no HTTP                                            | `node <dir>/dispatch-bench.mjs`                                               |
| `otel-stages.cjs`              | OpenTelemetry span trees with a stages runner vs onion                             | needs the packages below                                                      |
| `otel-diagnostics-channel.cjs` | Built-in HTTP channels; a framework `TracingChannel` with an OTel subscriber; cost | needs the packages below                                                      |

OTel scripts: install in a scratch folder `@opentelemetry/api@1.9`,
`@opentelemetry/sdk-trace-node@2.12.0`, `@opentelemetry/sdk-trace-base@2.12.0`,
`@opentelemetry/context-async-hooks@2.12.0`, `@opentelemetry/instrumentation@0.223.0`,
`@opentelemetry/instrumentation-http@0.223.0` and run the script from there.

Known limit (reviewer note, 2026-11-01): `retained-memory.mjs` suspends requests **inside the
handler**. It does not measure an active streaming response, where the middleware chain has already
returned the stream descriptor.

## Astro strict onion/H comparison

`strict-comparison.mjs` is a separate experiment for [Astro Proposal](../astro-proposal.md).
Unlike the original B memory model, its onion requires explicit continuation. It compares
equivalent suffix ALS scopes and gives both models the same response-hook facility. The harness
and JSON output document what is included, the baseline, and the limitations. A synthetic pending
writer is not a real socket or stream benchmark. These are research kernels, not production
middleware runners or evidence of a Rust speedup.

Run from the repository root:

```sh
node .plans/refactor/reference/middleware-experiments/strict-comparison.mjs --conformance-only
node .plans/refactor/reference/middleware-experiments/strict-comparison.mjs --output=.plans/refactor/reference/middleware-experiments/strict-comparison-results.json
```

The default measurement uses 10,000 pending requests and five fresh processes per cell. Optional
`--requests`, `--processes` and `--hooks=0|1|2` arguments change that configuration. The checked-in
[results](strict-comparison-results.json) contain all samples and method limitations; the
[proposal](../astro-proposal.md#measurements-and-decision-gate) explains the conclusions.
