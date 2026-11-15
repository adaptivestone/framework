// biome-ignore-all lint: experiment script kept as it was run; see ../README.md
// biome-ignore-all lint: experiment script kept as it was run; see README.md
// Dispatch-cost micro-benchmark for middleware flow models (no HTTP).
// Each model runs N middleware + one handler per "request"; we report the
// median nanoseconds per request over several runs.
import { EventEmitter } from 'node:events';

const RUNS = 5;
const ITER = 60_000;

// ── models ──────────────────────────────────────────────────────────────

// Linear, request-only (proposed v2): return undefined = continue, value = stop.
async function linear(mws, handler, ctx) {
  for (let i = 0; i < mws.length; i += 1) {
    const r = await mws[i](ctx);
    if (r !== undefined) return r;
  }
  return handler(ctx);
}

// Linear + onFinish callbacks run after the handler (the "after" work).
async function linearOnFinish(mws, handler, ctx) {
  ctx.finish = [];
  for (let i = 0; i < mws.length; i += 1) {
    const r = await mws[i](ctx);
    if (r !== undefined) return r;
  }
  const res = await handler(ctx);
  for (let i = 0; i < ctx.finish.length; i += 1) ctx.finish[i](res);
  return res;
}

// Onion, koa-compose style: next() returns the downstream result.
function compose(mws, handler) {
  return function run(ctx) {
    let index = -1;
    function dispatch(i) {
      if (i <= index) return Promise.reject(new Error('next() called twice'));
      index = i;
      const fn = i === mws.length ? handler : mws[i];
      try {
        return Promise.resolve(fn(ctx, dispatch.bind(null, i + 1)));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return dispatch(0);
  };
}

// Separate phases: request hooks → handler → response hooks (Fastify/hapi-like).
async function phases(before, handler, after, ctx) {
  for (let i = 0; i < before.length; i += 1) {
    const r = await before[i](ctx);
    if (r !== undefined) return r;
  }
  let res = await handler(ctx);
  for (let i = 0; i < after.length; i += 1) {
    const r = await after[i](ctx, res);
    if (r !== undefined) res = r;
  }
  return res;
}

// Current v1 bridge (ExpressAdapter.runMiddleware): a Promise per middleware,
// settled by next() or res 'finish'/'close', with listeners added and removed.
async function v1Bridge(mws, handler, ctx) {
  const res = ctx.res;
  for (let i = 0; i < mws.length; i += 1) {
    await new Promise((resolve, reject) => {
      let done = false;
      const settle = (err) => {
        if (done) return;
        done = true;
        res.off('finish', settle);
        res.off('close', settle);
        if (err) reject(err);
        else resolve();
      };
      res.once('finish', settle);
      res.once('close', settle);
      Promise.resolve(mws[i](ctx, settle)).catch(settle);
    });
  }
  return handler(ctx);
}

// ── workloads ───────────────────────────────────────────────────────────

const RESPONSE = { status: 200, headers: {} };
const handler = async () => RESPONSE;

// "Request" work only (auth-like): set a value.
const reqMw = (i) => async (ctx) => {
  ctx.state[i] = true;
};
const reqMwNext = (i) => async (ctx, next) => {
  ctx.state[i] = true;
  return next();
};
const reqMwV1 = (i) => async (ctx, next) => {
  ctx.state[i] = true;
  next();
};

// "Before + after" work (timing-like): read a clock before, set a header after.
const aroundOnion = (i) => async (ctx, next) => {
  ctx.state[i] = 1;
  const res = await next();
  res.headers[`x-${i}`] = '1';
  return res;
};
const aroundBefore = (i) => async (ctx) => {
  ctx.state[i] = 1;
};
const aroundAfter = (i) => async (_ctx, res) => {
  res.headers[`x-${i}`] = '1';
};
const aroundFinish = (i) => async (ctx) => {
  ctx.state[i] = 1;
  ctx.finish.push((res) => {
    res.headers[`x-${i}`] = '1';
  });
};

function makeCtx() {
  return { state: {}, res: new EventEmitter() };
}

async function measure(fn) {
  for (let i = 0; i < 20_000; i += 1) await fn(makeCtx()); // warm-up
  const samples = [];
  for (let r = 0; r < RUNS; r += 1) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < ITER; i += 1) await fn(makeCtx());
    samples.push(Number(process.hrtime.bigint() - start) / ITER);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const rows = [];
for (const n of [0, 5, 10]) {
  const idx = [...Array(n).keys()];
  // Scenario 1: request-only work.
  const lin = idx.map(reqMw);
  const onion = compose(idx.map(reqMwNext), handler);
  const v1 = idx.map(reqMwV1);
  rows.push({
    scenario: 'request-only',
    n,
    model: 'linear (v2)',
    ns: await measure((c) => linear(lin, handler, c)),
  });
  rows.push({
    scenario: 'request-only',
    n,
    model: 'onion',
    ns: await measure((c) => onion(c)),
  });
  rows.push({
    scenario: 'request-only',
    n,
    model: 'phases',
    ns: await measure((c) => phases(lin, handler, [], c)),
  });
  rows.push({
    scenario: 'request-only',
    n,
    model: 'v1 bridge (today)',
    ns: await measure((c) => v1Bridge(v1, handler, c)),
  });
  // Scenario 2: before + after work in every middleware.
  const onionAround = compose(idx.map(aroundOnion), handler);
  const before = idx.map(aroundBefore);
  const after = idx.map(aroundAfter);
  const finish = idx.map(aroundFinish);
  rows.push({
    scenario: 'before+after',
    n,
    model: 'onion',
    ns: await measure((c) => onionAround(c)),
  });
  rows.push({
    scenario: 'before+after',
    n,
    model: 'phases',
    ns: await measure((c) => phases(before, handler, after, c)),
  });
  rows.push({
    scenario: 'before+after',
    n,
    model: 'linear + onFinish',
    ns: await measure((c) => linearOnFinish(finish, handler, c)),
  });
}

console.log(
  `node ${process.version}, ${ITER} requests × ${RUNS} runs, median ns/request`,
);
for (const r of rows) {
  console.log(
    `${r.scenario.padEnd(13)} n=${String(r.n).padEnd(3)} ${r.model.padEnd(20)} ${r.ns.toFixed(0).padStart(6)} ns`,
  );
}
