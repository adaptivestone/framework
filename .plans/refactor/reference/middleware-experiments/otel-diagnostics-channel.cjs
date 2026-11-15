// biome-ignore-all lint: experiment script kept as it was run; see README.md
// Node's built-in diagnostics_channel / TracingChannel with a stages runner and real OTel.
const dc = require('node:diagnostics_channel');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const {
  SimpleSpanProcessor,
  InMemorySpanExporter,
} = require('@opentelemetry/sdk-trace-base');
const {
  AsyncLocalStorageContextManager,
} = require('@opentelemetry/context-async-hooks');
const { trace, context } = require('@opentelemetry/api');

const exporter = new InMemorySpanExporter();
const contextManager = new AsyncLocalStorageContextManager();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register({ contextManager });
const tracer = trace.getTracer('exp');
const http = require('http');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function db(name) {
  const s = tracer.startSpan(`db ${name}`);
  await sleep(3);
  s.end();
}

// ── Part 1: which built-in channels fire for one request ──
const seen = [];
for (const name of [
  'net.server.socket',
  'http.server.request.start',
  'http.server.response.created',
  'http.server.response.finish',
]) {
  dc.subscribe(name, () => seen.push(name));
}
const httpTracing = dc.tracingChannel('http.server.request');
httpTracing.subscribe({
  start: () => seen.push('tracing:http.server.request:start'),
  end: () => seen.push('tracing:http.server.request:end'),
  asyncStart: () => seen.push('tracing:http.server.request:asyncStart'),
  asyncEnd: () => seen.push('tracing:http.server.request:asyncEnd'),
  error: () => seen.push('tracing:http.server.request:error'),
});

// ── Part 2: the framework publishes a TracingChannel around the handler ──
const handlerChannel = dc.tracingChannel('adaptivestone:handler');
async function runStages(ctx, middlewares, handler) {
  for (const mw of middlewares) {
    const r = await mw(ctx);
    if (r) return r;
  }
  // tracePromise is a plain call when nobody subscribes.
  return handlerChannel.tracePromise(() => handler(ctx), { route: ctx.route });
}
const handler = async () => {
  await db('insert order');
  return { status: 201 };
};
const auth = async () => {
  await db('find user');
};

// What an OTel integration would do: span per handler call, made ACTIVE for the handler
// by binding OTel's AsyncLocalStorage to the channel's start event (no wrapping in middleware).
const otelAls = contextManager._asyncLocalStorage; // the context manager's store (internal field)
handlerChannel.start.bindStore(otelAls, (msg) => {
  msg.span = tracer.startSpan(`handler ${msg.route}`);
  return trace.setSpan(context.active(), msg.span);
});
handlerChannel.subscribe({
  asyncEnd: (msg) => msg.span?.end(),
  error: (msg) => {
    msg.span?.recordException(msg.error);
    msg.span?.end();
  },
});

const server = http.createServer(async (req, res) => {
  // No OTel http instrumentation here: start a server span by hand to stand in for it.
  const serverSpan = tracer.startSpan('POST /orders');
  await context.with(trace.setSpan(context.active(), serverSpan), async () => {
    const response = await runStages(
      { route: 'POST /orders' },
      [auth],
      handler,
    );
    res.statusCode = response.status;
    res.end();
  });
  serverSpan.end();
});

function tree(spans) {
  const kids = new Map();
  for (const s of spans) {
    const p = s.parentSpanContext?.spanId;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(s);
  }
  const walk = (s, d) => {
    console.log(`${'  '.repeat(d)}- ${s.name}`);
    (kids.get(s.spanContext().spanId) ?? []).forEach((k) => walk(k, d + 1));
  };
  spans.filter((s) => !s.parentSpanContext).forEach((r) => walk(r, 0));
}

// ── Part 3: cost of tracePromise with and without subscribers ──
async function cost() {
  const quiet = dc.tracingChannel('adaptivestone:quiet');
  const fn = async () => 1;
  const N = 1_000_000;
  for (let i = 0; i < 100_000; i += 1) {
    await fn();
    await quiet.tracePromise(fn, {});
  }
  let t = process.hrtime.bigint();
  for (let i = 0; i < N; i += 1) await fn();
  const plain = Number(process.hrtime.bigint() - t) / N;
  t = process.hrtime.bigint();
  for (let i = 0; i < N; i += 1) await quiet.tracePromise(fn, {});
  const traced = Number(process.hrtime.bigint() - t) / N;
  quiet.subscribe({
    start() {},
    end() {},
    asyncStart() {},
    asyncEnd() {},
    error() {},
  });
  t = process.hrtime.bigint();
  for (let i = 0; i < N; i += 1) await quiet.tracePromise(fn, {});
  const subscribed = Number(process.hrtime.bigint() - t) / N;
  console.log(
    `\ncost per call: plain ${plain.toFixed(0)} ns · tracePromise, no subscriber ${traced.toFixed(0)} ns · with a subscriber ${subscribed.toFixed(0)} ns`,
  );
}

server.listen(0, async () => {
  const { port } = server.address();
  await new Promise((resolve) => {
    const req = http.request({ port, method: 'POST', path: '/orders' }, (r) => {
      r.resume();
      r.on('end', resolve);
    });
    req.end();
  });
  await sleep(30);
  console.log(
    `node ${process.version}\n\nbuilt-in channels, in order:\n  ${[...new Set(seen)].join('\n  ')}`,
  );
  console.log('\nspan tree (handler span created by a channel subscriber):');
  tree(exporter.getFinishedSpans());
  server.close();
  await cost();
});
