# P1r — Public cluster runner

**Status**: 🟡 implemented 2026-07-18 · packed-package smoke pending
**Target**: v5.2.x, additive
**Depends on**: current internal `src/cluster.ts` supervision + graceful server shutdown
**Origin**: consumers currently copy `node:cluster` lifecycle code even though the framework
already maintains bounded restarts and signal forwarding for its own `prod` script.

## Goal

Extract the current internal cluster launcher into a supported package export so a bare-metal
consumer can opt into multi-process supervision without copying cluster code.

```ts
import { runCluster } from '@adaptivestone/framework/cluster.js';

await runCluster(async () => {
  await import('./server.ts');
}, {
  workers: 'auto',
  restart: {
    maxInWindow: 20,
    windowMs: 60_000,
    backoff: { initialMs: 500, maxMs: 30_000, multiplier: 2, jitter: true },
  },
  drainTimeoutMs: 30_000,
});
```

`runCluster` executes the callback only in workers. The primary owns forking, restart policy,
signal forwarding, and final exit status. Because `cluster.fork()` re-executes the consumer entry
module, the API is a callback rather than a hardwired path to the framework's `index.ts`.

## Required behavior

- Configurable worker count (`'auto'` = available parallelism, or a positive integer).
- SIGTERM/SIGINT forwarding; no worker resurrection during shutdown.
- Bounded restarts in a rolling window and exponential backoff with optional jitter.
- Clean worker exit is not restarted; abnormal exit is restarted within the budget.
- Primary enforces `drainTimeoutMs`, then force-terminates stuck workers and exits non-zero.
- Injectable logging callbacks; safe console defaults before an app logger exists.
- No hidden `--watch`; consumers/deployment tooling choose watch behavior.
- The existing `src/cluster.ts` entry becomes a thin invocation of the public runner so the two
  implementations cannot drift.

## Deployment guidance

The documentation must present clustering as optional. Kubernetes, systemd, PM2, and similar
supervisors should normally run one framework process per managed unit and own replica count and
restarts themselves. `runCluster` is for deployments that intentionally want one Node primary to
supervise several workers on the same host.

## Expected files

- `src/clusterRunner.ts` — public function/types and injectable internal runtime.
- `src/cluster.ts` — side-effect-free package entry and thin executable wrapper.
- `src/cluster.test.ts` — primary/worker state-machine tests with injected cluster/process seams.
- `package.json` — explicit `./cluster.js` export and packaging smoke coverage.
- Documentation: deployment/lifecycle chapter with single-process and clustered examples.
- `CHANGELOG.md` — additive public export.

## Out of scope

- A general process manager, daemon, zero-downtime binary upgrade, or container orchestrator.
- Cross-host coordination and shared listening sockets beyond `node:cluster` behavior.
- Bun/Deno/Workers support; this export is explicitly Node-only.
- Restarting after the configured crash-loop budget is exhausted.

## Done when

- A packed-package consumer imports `@adaptivestone/framework/cluster.js` and starts N workers.
- Signal, clean-exit, abnormal-exit, exponential-backoff, restart-budget, and drain-timeout tests
  are deterministic and green.
- The framework's own production entry uses the same public implementation.
- Docs explain when **not** to use it.

## Verification

- ✅ Eleven deterministic lifecycle tests: worker-only callback, auto worker count, clean exit,
  abnormal restart, exponential backoff, rolling-window reset, restart budget, signals, pending
  restart cancellation, drain failure propagation, and timeout.
- ✅ TypeScript build and focused Biome checks.
- ✅ Example project migrated; deployment docs production build.
- ⏳ Packed-package smoke now imports the public entry and starts one real worker, but could not be
  executed in this workspace because npm cache access required an unavailable sandbox escalation.
