# P1r — Public cluster runner

**Status**: 🟢 implemented and verified 2026-07-18 · awaiting `[NEXT]` release
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
  shutdownTimeoutMs: 30_000,
  onEvent: event => observability.record(event.type, event),
});
```

`runCluster` executes the callback only in workers. The primary owns forking, fixed safety policy,
signal forwarding, and final exit status. Because `cluster.fork()` re-executes the consumer entry
module, the API is a callback rather than a hardwired path to the framework's `index.ts`. Advanced
restart policy remains the responsibility of deployment supervisors rather than a permanent
framework compatibility surface.

## Required behavior

- Configurable worker count (`'auto'` = available parallelism, or a positive integer).
- SIGTERM/SIGINT forwarding; no worker resurrection during shutdown.
- Fixed one-second abnormal-exit restart delay and a fixed rolling crash-loop limit.
- Clean worker exit is not restarted; abnormal exit is restarted within the budget.
- Primary enforces `shutdownTimeoutMs`, then force-terminates stuck workers and exits non-zero.
- Structured `onEvent` hook; safe console output before application observability exists.
- No hidden `--watch`; consumers/deployment tooling choose watch behavior.
- The existing `src/cluster.ts` entry becomes a thin invocation of the public runner so the two
  implementations cannot drift.

## Deployment guidance

The documentation must present clustering as optional. Kubernetes, systemd, PM2, and similar
supervisors should normally run one framework process per managed unit and own replica count and
restarts themselves. `runCluster` is for deployments that intentionally want one Node primary to
supervise several workers on the same host.

## Expected files

- `src/clusterRunner.ts` — public function/types and direct Node lifecycle implementation.
- `src/cluster.ts` — side-effect-free package entry and thin executable wrapper.
- `src/cluster.test.ts` — primary/worker lifecycle tests with mocked Node cluster/process boundaries.
- `package.json` — explicit `./cluster.js` export and packaging smoke coverage.
- Documentation: deployment/lifecycle chapter with single-process and clustered examples.
- `CHANGELOG.md` — additive public export.

## Out of scope

- A general process manager, daemon, zero-downtime binary upgrade, or container orchestrator.
- User-configurable backoff, jitter, or restart-window policies.
- Cross-host coordination and shared listening sockets beyond `node:cluster` behavior.
- Bun/Deno/Workers support; this export is explicitly Node-only.
- Restarting after the fixed crash-loop safety limit is exhausted.

## Done when

- A packed-package consumer imports `@adaptivestone/framework/cluster.js` and starts N workers.
- Signal, clean-exit, abnormal-exit, fixed-delay, restart-budget, and shutdown-timeout tests
  are deterministic and green.
- The framework's own production entry uses the same public implementation.
- Docs explain when **not** to use it.

## Verification

- ✅ Ten deterministic lifecycle tests: worker-only callback, auto worker count, clean exit,
  fixed-delay abnormal restart, rolling-window reset, restart budget, signals, pending restart
  cancellation, shutdown timeout, and option validation.
- ✅ Production runner reduced from 418 to 278 lines; the shipped test-runtime abstraction and
  configurable process-manager policy were removed.
- ✅ TypeScript build and focused Biome checks.
- ✅ Example project migrated; deployment docs production build.
- ✅ Packed-package smoke imports the public entry, starts one real worker, observes its clean exit,
  and verifies the published export remains side-effect-free.
