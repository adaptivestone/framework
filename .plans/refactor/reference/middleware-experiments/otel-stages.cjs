// biome-ignore-all lint: experiment script kept as it was run; see README.md
// Does OpenTelemetry work with a "stages" (C2) middleware runner?
// Real @opentelemetry packages; http auto-instrumentation creates the server span.
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const {
  SimpleSpanProcessor,
  InMemorySpanExporter,
} = require('@opentelemetry/sdk-trace-base');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register(); // AsyncLocalStorage context manager
registerInstrumentations({ instrumentations: [new HttpInstrumentation()] });

const http = require('http'); // after instrumentation, so it gets patched
const { trace, context } = require('@opentelemetry/api');

const tracer = trace.getTracer('exp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Stand-in for an instrumented DB driver: starts a span under whatever is active.
async function db(name) {
  const span = tracer.startSpan(`db ${name}`);
  await sleep(3);
  span.end();
}

// ── C2 runner: request stage in order, onResponse notes newest first, onFinish after send ──
function makeCtx(req, res) {
  const ctx = { req, res, notes: [], finish: [] };
  ctx.onResponse = (fn) => ctx.notes.push(fn);
  ctx.scopes = [];
  ctx.scope = (wrap) => ctx.scopes.push(wrap); // opt-in: run the handler inside wrap(run)
  ctx.onFinish = (fn) => {
    if (ctx.finish.length === 0)
      res.once('finish', () => ctx.finish.forEach((f) => f()));
    ctx.finish.push(fn);
  };
  return ctx;
}
async function runC2(
  ctx,
  middlewares,
  handler,
  { frameworkSpans = false } = {},
) {
  let response;
  for (const mw of middlewares) {
    let r;
    if (frameworkSpans) {
      // Framework-owned tracing: the runner wraps each middleware call in its own span.
      const span = tracer.startSpan(`middleware ${mw.name}`);
      r = await context.with(trace.setSpan(context.active(), span), () =>
        mw(ctx),
      );
      span.end();
    } else {
      r = await mw(ctx);
    }
    if (r) {
      response = r;
      break;
    }
  }
  if (!response) {
    if (frameworkSpans) {
      const span = tracer.startSpan('handler POST /orders');
      response = await context.with(trace.setSpan(context.active(), span), () =>
        handler(ctx),
      );
      span.end();
    } else if (ctx.scopes.length) {
      // Only requests whose middleware asked for a scope pay for the wrapping.
      let run = () => handler(ctx);
      for (let i = ctx.scopes.length - 1; i >= 0; i -= 1) {
        const inner = run;
        const wrap = ctx.scopes[i];
        run = () => wrap(inner);
      }
      response = await run();
    } else {
      response = await handler(ctx);
    }
  }
  for (let i = ctx.notes.length - 1; i >= 0; i -= 1)
    response = (await ctx.notes[i](response)) ?? response;
  // Framework knows the route template: name the server span the semconv way.
  const server = trace.getActiveSpan();
  server?.setAttribute('http.route', '/orders');
  server?.updateName('POST /orders');
  ctx.res.statusCode = response.status;
  ctx.res.end(JSON.stringify(response.body));
}

// ── middleware and handler used by the scenarios ──
async function auth(ctx) {
  await db('find user');
}
async function timing(ctx) {
  const t0 = performance.now();
  ctx.onFinish(() => {
    ctx.durationMs = performance.now() - t0;
  });
}
// A middleware that creates a span for its OWN work (child of the active server span).
async function authWithSpan(ctx) {
  const span = tracer.startSpan('auth check');
  await context.with(trace.setSpan(context.active(), span), () =>
    db('find user'),
  );
  span.end();
}
// A middleware that wants the HANDLER's work nested under its span (needs wrapping).
async function txSpan(ctx) {
  const span = tracer.startSpan('transaction');
  ctx.onResponse((r) => {
    span.end();
    return r;
  });
}
const handler = async () => {
  await db('insert order');
  return { status: 201, body: { ok: true } };
};

// Same need, solved in the stages model with the opt-in scope hook.
async function txScope(ctx) {
  const span = tracer.startSpan('transaction');
  ctx.scope((run) => context.with(trace.setSpan(context.active(), span), run));
  ctx.onResponse((r) => {
    span.end();
    return r;
  });
}

// Onion version of txSpan for comparison.
async function runOnion(ctx, middlewares, handler) {
  const run = (i) =>
    i === middlewares.length
      ? handler(ctx)
      : middlewares[i](ctx, () => run(i + 1));
  const response = await run(0);
  ctx.res.statusCode = response.status;
  ctx.res.end(JSON.stringify(response.body));
}
async function txOnion(ctx, next) {
  const span = tracer.startSpan('transaction');
  try {
    return await context.with(trace.setSpan(context.active(), span), next);
  } finally {
    span.end();
  }
}

const routes = {
  '/c2-basic': (ctx) => runC2(ctx, [auth, timing], handler),
  '/c2-mw-span': (ctx) => runC2(ctx, [authWithSpan], handler),
  '/c2-want-parent': (ctx) => runC2(ctx, [txSpan], handler),
  '/c2-framework-wrap': (ctx) =>
    runC2(ctx, [auth, timing], handler, { frameworkSpans: true }),
  '/c2-scope': (ctx) => runC2(ctx, [txScope], handler),
  '/onion': (ctx) => runOnion(ctx, [txOnion], handler),
};

const server = http.createServer((req, res) =>
  routes[req.url](makeCtx(req, res)),
);

function printTree(spans) {
  const byId = new Map(spans.map((s) => [s.spanContext().spanId, s]));
  const kids = new Map();
  let roots = [];
  for (const s of spans) {
    const p = s.parentSpanContext?.spanId ?? s.parentSpanId;
    if (p && byId.has(p)) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(s);
    } else roots.push(s);
  }
  const walk = (s, d) => {
    const route = s.attributes['http.route']
      ? `  [http.route=${s.attributes['http.route']}]`
      : '';
    console.log(`${'  '.repeat(d)}- ${s.name}${route}`);
    for (const k of (kids.get(s.spanContext().spanId) ?? []).sort(
      (a, b) => a.startTime[1] - b.startTime[1],
    ))
      walk(k, d + 1);
  };
  roots = spans.filter((s) => s.kind === 1); // start at the SERVER span (its parent is the test client span)
  roots.forEach((r) => walk(r, 0));
}

server.listen(0, async () => {
  const { port } = server.address();
  for (const path of Object.keys(routes)) {
    exporter.reset();
    await new Promise((resolve) =>
      http.get({ port, path }, (res) => {
        res.resume();
        res.on('end', resolve);
      }),
    );
    await sleep(20);
    console.log(`\n${path}`);
    const all = exporter.getFinishedSpans();
    if (process.env.DEBUG)
      for (const s of all)
        console.log(
          '  raw',
          s.name,
          'kind',
          s.kind,
          'parent',
          JSON.stringify(s.parentSpanContext ?? s.parentSpanId),
        );
    printTree(all);
  }
  server.close();
});
