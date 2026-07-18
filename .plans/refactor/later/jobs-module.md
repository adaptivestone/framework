# P2e — Abstract jobs module with durable drivers

**Status**: 📝 documented 2026-07-18 · deferred until the metrics foundation and a concrete driver
package are selected
**Target**: v5.3+ or separately versioned `@adaptivestone/framework-module-jobs`
**Depends on**: [Observability Phase 1 metrics API](../queued/metrics-seam.md); app lifecycle outside HTTP
**Origin**: email dispatch and activity persistence need explicit delivery state, bounded retry,
dead letters, and observability. Detached promises reduced to logs cannot distinguish accepted work
from lost work.

## Direction

Jobs are a module, not a Redis dependency in framework core. Core may expose only shared types and
an optional `app.jobs` module slot; the jobs package owns orchestration and drivers. There is no
silent no-op driver: claiming to enqueue durable work and dropping it is data loss.

```ts
app.jobs.define(
  'sendEmail',
  SendEmailPayload,
  async (payload, context) => {
    await email.send(payload);
  },
  { retries: 5, backoff: 'exponential' },
);

const receipt = await app.jobs.enqueue('sendEmail', payload, {
  idempotencyKey: `welcome:${user.id}`,
});

await app.jobs.status(receipt.id); // queued | running | succeeded | failed | dead-lettered

app.jobs.onDeadLetter((job, error) => {
  app.logger.error({ job, error }, 'Job dead-lettered');
});
```

## Driver contract

Drivers provide durable enqueue/reservation/acknowledgement and delayed retry primitives. The
module owns named handler registration, payload validation, retry policy, delivery state,
idempotency conventions, logging, metrics, and graceful worker shutdown.

Initial likely drivers:

- Redis-backed durable driver in an optional module/package.
- In-memory driver explicitly marked development/test-only and non-durable.
- Custom driver registration for SQS, RabbitMQ, Postgres, or hosted queues.

Semantics are **at least once**, not exactly once. Handlers must be idempotent; a worker may finish
the side effect and die before acknowledgement. An idempotency key helps drivers deduplicate but
does not magically make arbitrary external effects transactional.

## Required delivery state and observability

- Stable job ID and receipt from durable enqueue.
- `queued → running → succeeded | retrying | failed | dead-lettered` state.
- Bounded retries with exponential/fixed backoff and optional jitter.
- Lease/visibility timeout so abandoned jobs become runnable again.
- Dead-letter inspection/replay hook with original payload protected by application access rules.
- Structured logs plus `jobs.enqueued`, `jobs.completed`, `jobs.failed`, `jobs.dead_lettered`,
  `jobs.duration_ms`, and queue-depth metrics through P1s.
- Payload Standard Schema validation at enqueue and before handler execution when configured.
- Worker lifecycle independent of `bootHttp`; CLI/worker processes must initialize jobs without
  starting an HTTP server.

## Package boundary

Preferred split:

```text
@adaptivestone/framework                 shared Job types / optional app slot
@adaptivestone/framework-module-jobs     orchestrator + memory test driver
@adaptivestone/jobs-driver-redis         durable Redis implementation
```

A single module with bundled Redis may be chosen initially, but Redis remains optional to core and
must be lazy-loaded only when that driver is selected.

## Out of scope initially

- Cron/calendar scheduling, priorities, DAGs/workflows, fan-out orchestration, job batching, or UI.
- Exactly-once delivery claims.
- Running arbitrary unregistered code from queue payloads.
- Silent fallback from a durable driver to memory when the backend is unavailable.
- Treating a successful enqueue as proof the eventual side effect succeeded; callers receive a
  receipt and query/subscribe to delivery state where product behavior needs confirmation.

## Done when

- Email/activity work can be durably accepted, retried, observed, and dead-lettered.
- Driver loss cannot silently degrade to fire-and-forget or memory.
- Duplicate delivery behavior is tested and documented with an idempotent handler example.
- A worker drains leases/handlers on shutdown and abandoned work is recoverable.
- A consumer can delete floating delivery promises while preserving request latency.
