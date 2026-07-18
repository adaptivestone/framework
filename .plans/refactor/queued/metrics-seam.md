# P1s — Observability Phase 1: metrics

**Status**: ✅ direction settled 2026-07-18 · implementation not started
**Target**: v5.2.x, additive; core seam can land before the HTTP/exporter slice
**Depends on**: app lifecycle/config; automatic response metrics use
[P1q ResponseWriter](./universal-http-responses.md)
**Feeds**: [observability phases 2+](../later/observability.md), jobs/queues,
rate-limiter and cache degradation signals
**Origin**: best-effort operations currently emit logs only. Logs explain individual failures but
cannot cheaply answer rate/state questions such as “how many activity writes failed per minute?”
or “is queue depth growing?”.

## Why a metrics seam exists separately from logs

| Signal | Best for | Poor at |
|---|---|---|
| Log | One event with diagnostic context/stack | Aggregated rates and current state |
| Counter | Total occurrences; alert on rate increase | Current value or latency distribution |
| Gauge | Current queue depth/connections/in-flight work | Monotonic event totals |
| Histogram | Latency/size distribution and percentiles | Explaining one failure |

A degradation contract normally uses both: increment a bounded counter for alerting and log the
specific error for diagnosis. Parsing logs into metrics is exporter-specific, expensive, and easy
to break when prose changes.

## Deliverable

This phase is a useful metrics vertical slice, not only an interface left for consumers to wire:

1. Always-present vendor-neutral `app.metrics` API with no-op and memory drivers.
2. Automatic parameterized-route HTTP RED metrics: request rate, errors and duration, plus
   in-flight requests and response size.
3. Process/runtime metrics: memory, CPU, event-loop delay and uptime.
4. One production Prometheus driver, lazy-loaded as an optional dependency.
5. An opt-in `/metrics` endpoint registered through the framework route registry.
6. Framework component metrics for degradation paths as those components are touched.

Tracing, log correlation, health checks, Sentry and profiling remain later phases. They build on
the same normalized route/response lifecycle without blocking a production-useful metrics release.

## Public API

Calls are synchronous, allocation-light, and never awaited. Drivers buffer/export asynchronously;
request and job execution must not wait on a monitoring backend.

```ts
app.metrics.increment(name, value?, attributes?);
app.metrics.gauge(name, value, attributes?);
app.metrics.observe(name, value, attributes?);
```

```ts
interface MetricsDriver {
  increment(
    name: string,
    value: number,
    attributes?: Readonly<Record<string, string | number | boolean>>,
  ): void;
  gauge(
    name: string,
    value: number,
    attributes?: Readonly<Record<string, string | number | boolean>>,
  ): void;
  observe(
    name: string,
    value: number,
    attributes?: Readonly<Record<string, string | number | boolean>>,
  ): void;
  shutdown?(): void | Promise<void>;
}
```

The default driver is a no-op. The first production driver is Prometheus; StatsD and OpenTelemetry
drivers can follow through the same interface. Exporter dependencies are optional and lazy-loaded.
Driver failures are swallowed and reported through a deduplicated logger warning: observability
must not turn a successful request into a 500.

```ts
// config/metrics.ts
export default {
  driver: 'prometheus', // 'none' by default
  path: '/metrics',
  collectHttp: true,
  collectRuntime: true,
};
```

The endpoint is absent when the driver is `none`; enabling it must be explicit. Authentication or
network restriction remains deployment/application policy, and the documentation must warn not to
expose operational metrics publicly by accident.

## Automatic HTTP and runtime metrics

The route registry supplies the parameterized route template and P1q's writer supplies the final
status and response byte count for JSON, text, stream, file, redirect, empty and error responses.
Controllers do not add instrumentation.

Initial HTTP instruments:

| Instrument | Kind | Bounded attributes |
|---|---|---|
| `http.server.requests` | counter | method, parameterized route, status, outcome |
| `http.server.duration_ms` | histogram | method, parameterized route, status |
| `http.server.active_requests` | gauge | method |
| `http.server.response_size_bytes` | histogram | method, parameterized route, status |

Unmatched requests use a fixed route value such as `unmatched`, never the raw URL. Streaming
duration ends when the response closes, not when the stream descriptor is returned. Aborted
responses have a bounded `outcome: 'aborted'` classification.

Runtime collection includes process resident/heap memory, CPU time, uptime and event-loop delay.
Names should align with the selected exporter ecosystem where possible; the public driver-neutral
API does not promise that every backend uses identical wire names.

## Examples

### Best-effort activity persistence

```ts
try {
  await Activity.create(event);
} catch (error) {
  app.metrics.increment('audit.write_failed');
  app.logger.error({ error, eventType: event.type }, 'Activity write failed');
}
```

Alert on the counter's five-minute rate; use the log to inspect the underlying exception.

### Queue delivery state

```ts
app.metrics.increment('jobs.enqueued', 1, { queue: 'email' });
app.metrics.gauge('jobs.queue_depth', depth, { queue: 'email' });
app.metrics.observe('jobs.duration_ms', elapsedMs, {
  queue: 'email',
  outcome: 'success',
});
app.metrics.increment('jobs.dead_lettered', 1, { queue: 'email' });
```

This supports alerts for growing depth, delivery failure rate, dead letters, and latency without
making the jobs module depend on one metrics vendor.

### Infrastructure degradation

```ts
app.metrics.increment('rate_limiter.store_failed', 1, { driver: 'redis' });
app.metrics.increment('cache.operation_failed', 1, {
  driver: 'redis',
  operation: 'get',
});
app.metrics.observe('http.file.bytes', deliveredBytes, { driver: 'local' });
```

### Test assertion

```ts
const metrics = new MemoryMetricsDriver();
app.metrics.setDriver(metrics);

await service.perform();

expect(metrics.counter('audit.write_failed')).toBe(1);
```

The in-memory driver is a test helper, not the production default.

## Attribute/cardinality rules

Metric attributes create a time series for every distinct combination. Unbounded attributes can
exhaust Prometheus/OTel backends and memory.

Allowed examples: parameterized route, HTTP method/status, configured driver, queue name,
operation, bounded outcome/error category. Forbidden examples: user ID, email, job ID, storage
key, raw URL, request body, exception message, stack, or arbitrary tenant unless the deployment
has an explicit bounded tenant budget.

Errors must be classified (`error: 'timeout' | 'connection' | 'unknown'`), never copied into an
attribute. Detailed values belong in logs/traces.

## Multiprocess semantics

Each Node worker records local values. Counters/histograms naturally aggregate in the backend.
Gauges require exporter-aware aggregation: a queue-depth gauge should normally be observed from
one authoritative worker/backend, while process-local gauges such as in-flight requests may sum
across workers. The framework does not pretend an in-memory gauge is cluster-global.

## Expected files

- New `src/services/metrics/Metrics.ts`, `MetricsDriver.ts`, `NoopMetricsDriver.ts` and tests.
- `src/server.ts` / `IApp` — always-present `app.metrics`, driver registration, shutdown hook.
- New test-only `MemoryMetricsDriver` export.
- Optional Prometheus driver/module, lazy dependency loading and route-registry `/metrics` handler.
- HTTP adapter/response-writer timing hooks and runtime collector with fake-clock tests.
- Documentation: metric types, driver setup, usage recipes, cardinality rules.
- `CHANGELOG.md` and packaging smoke coverage.
- P2b observability plan updated to treat tracing/health/log correlation as phases 2+.

## Out of scope

- Making Prometheus/StatsD/OTel a mandatory core dependency.
- Dashboards, alert definitions, tracing, log correlation, health endpoints, Sentry, or profiling.
- Automatic business metrics or scanning logs.
- Distributed/global gauge correctness without an exporter/backend that supports it.

## Done when

- `app.metrics` is always callable with zero configuration and near-zero no-op overhead.
- A custom and in-memory test driver receive counter/gauge/histogram calls with attributes.
- The Prometheus driver exposes an opt-in `/metrics` endpoint without loading its dependency when
  disabled.
- Successful, failed, streamed and aborted HTTP responses emit RED metrics with normalized routes,
  correct final statuses and bounded attributes.
- Runtime metrics are emitted when enabled and stop/flush cleanly at shutdown.
- Driver exceptions never change application control flow.
- Shutdown flushes drivers that expose `shutdown`.
- Documentation includes failure+log, queue, degradation, testing, and cardinality examples.
