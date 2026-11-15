// biome-ignore-all lint: experiment script kept as it was run; see ../README.md
// biome-ignore-all lint: experiment script kept as it was run; see README.md
// Retained heap per pending request, one model per process (clean heap), median of 5.
// usage: node --expose-gc retained3.mjs <model A|B|C1|C2|D|H|C2W|none> <MW> <AROUND> <N> [als]
// als: the AROUND middleware give the rest of the request their own AsyncLocalStorage store.
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();
const [, , MODEL, MWs = '10', AROUNDs = '2', Ns = '10000', MODE = 'timing'] =
  process.argv;
const ALS = MODE === 'als';
const MW = +MWs,
  AROUND = +AROUNDs,
  N = +Ns;
const RESPONSE = Object.freeze({ status: 200, headers: Object.freeze([]) });
const isResponse = (v) =>
  v !== undefined && v !== null && v.status !== undefined;
const heap = () => {
  global.gc();
  global.gc();
  return process.memoryUsage().heapUsed;
};

function modelA() {
  const mws = [];
  for (let i = 0; i < MW; i++)
    mws.push(
      i < AROUND
        ? {
            async middleware(ctx) {
              const t0 = performance.now();
              ctx.onFinish(() => {
                ctx.state.t = performance.now() - t0;
              });
            },
          }
        : {
            async middleware(ctx) {
              ctx.state[i] = true;
            },
          },
    );
  return async (ctx, handler) => {
    for (let i = 0; i < mws.length; i++) {
      const r = await mws[i].middleware(ctx);
      if (isResponse(r)) return r;
    }
    return handler(ctx);
  };
}
function modelB() {
  const mws = [];
  for (let i = 0; i < MW; i++)
    mws.push(
      i < AROUND
        ? {
            async middleware(ctx, next) {
              if (ALS) return store.run({ i }, next);
              const t0 = performance.now();
              const res = await next();
              ctx.state.t = performance.now() - t0;
              return res;
            },
          }
        : {
            async middleware(ctx) {
              ctx.state[i] = true;
            },
          },
    );
  async function run(ctx, handler, i) {
    if (i === mws.length) return handler(ctx);
    let downstream;
    const next = () => {
      if (downstream) throw new Error('twice');
      downstream = run(ctx, handler, i + 1);
      return downstream;
    };
    const result = await mws[i].middleware(ctx, next);
    if (isResponse(result)) return result;
    return downstream ?? run(ctx, handler, i + 1);
  }
  return (ctx, handler) => run(ctx, handler, 0);
}
function modelC1() {
  const mws = [];
  for (let i = 0; i < MW; i++)
    mws.push(
      i < AROUND
        ? {
            async request(ctx) {
              ctx.state[`t${i}`] = performance.now();
            },
            async response(ctx, res) {
              ctx.state.t = performance.now() - ctx.state[`t${i}`];
              return res;
            },
          }
        : {
            async request(ctx) {
              ctx.state[i] = true;
            },
          },
    );
  return async (ctx, handler) => {
    let ran = 0,
      res;
    for (let i = 0; i < mws.length; i++) {
      ran = i + 1;
      const r = await mws[i].request(ctx);
      if (isResponse(r)) {
        res = r;
        break;
      }
    }
    if (!res) res = await handler(ctx);
    for (let i = ran - 1; i >= 0; i--)
      if (mws[i].response) {
        const r = await mws[i].response(ctx, res);
        if (isResponse(r)) res = r;
      }
    return res;
  };
}
function modelC2() {
  const mws = [];
  for (let i = 0; i < MW; i++)
    mws.push(
      i < AROUND
        ? {
            async middleware(ctx) {
              const t0 = performance.now();
              ctx.onResponse((res) => {
                ctx.state.t = performance.now() - t0;
                return res;
              });
            },
          }
        : {
            async middleware(ctx) {
              ctx.state[i] = true;
            },
          },
    );
  return async (ctx, handler) => {
    let res;
    for (let i = 0; i < mws.length; i++) {
      const r = await mws[i].middleware(ctx);
      if (isResponse(r)) {
        res = r;
        break;
      }
    }
    if (!res) res = await handler(ctx);
    const cbs = ctx._onResponse;
    if (cbs)
      for (let i = cbs.length - 1; i >= 0; i--) {
        const r = await cbs[i](res);
        if (isResponse(r)) res = r;
      }
    return res;
  };
}
function modelD() {
  const mws = [];
  for (let i = 0; i < MW; i++)
    mws.push(
      i < AROUND
        ? async (ctx, next) => {
            if (ALS) return store.run({ i }, next);
            const t0 = performance.now();
            const res = await next();
            ctx.state.t = performance.now() - t0;
            return res;
          }
        : async (ctx) => {
            ctx.state[i] = true;
          },
    );
  let chain = (ctx, handler) => handler(ctx);
  for (let i = mws.length - 1; i >= 0; i--) {
    const fn = mws[i];
    const inner = chain;
    chain = (ctx, handler) => {
      let called = false,
        result;
      const next = () => {
        if (called) return result;
        called = true;
        result = inner(ctx, handler);
        return result;
      };
      const ret = fn(ctx, next);
      return ret === undefined
        ? next()
        : typeof ret?.then === 'function'
          ? ret.then((r) => (r === undefined ? next() : r))
          : ret;
    };
  }
  return chain;
}

// BL — onion, flat-loop runner: request-only layers run in one loop frame, only a layer that
// calls next() makes the runner recurse. Same contract as B (auto-next, branded stop).
function modelBL() {
  const mws = [];
  for (let i = 0; i < MW; i++)
    mws.push(
      i < AROUND
        ? {
            async middleware(ctx, next) {
              if (ALS) return store.run({ i }, next);
              const t0 = performance.now();
              const res = await next();
              ctx.state.t = performance.now() - t0;
              return res;
            },
          }
        : {
            async middleware(ctx) {
              ctx.state[i] = true;
            },
          },
    );
  async function run(ctx, handler, start) {
    for (let i = start; i < mws.length; i++) {
      let downstream;
      const next = () => {
        if (downstream) throw new Error('twice');
        downstream = run(ctx, handler, i + 1);
        return downstream;
      };
      const result = await mws[i].middleware(ctx, next);
      if (isResponse(result)) return result;
      if (downstream) return downstream;
    }
    return handler(ctx);
  }
  return (ctx, handler) => run(ctx, handler, 0);
}
// H — hybrid by declaration: a middleware has run(ctx) (stage) OR around(ctx, next) (wraps the rest).
// The chain is composed once at startup; stage middleware run in a flat loop, only around pays.
function modelH() {
  const mws = [];
  for (let i = 0; i < MW; i++)
    mws.push(
      i < AROUND
        ? {
            async around(ctx, next) {
              if (ALS) return store.run({ i }, next);
              const t0 = performance.now();
              const res = await next();
              ctx.state.t = performance.now() - t0;
              return res;
            },
          }
        : {
            async run(ctx) {
              ctx.state[i] = true;
            },
          },
    );
  function compile(i) {
    const stages = [];
    let j = i;
    while (j < mws.length && !mws[j].around) stages.push(mws[j++]);
    const wrapper = j < mws.length ? mws[j] : null;
    const inner = wrapper ? compile(j + 1) : null;
    return async (ctx, handler) => {
      for (let k = 0; k < stages.length; k++) {
        const r = await stages[k].run(ctx);
        if (isResponse(r)) return r;
      }
      if (!wrapper) return handler(ctx);
      return wrapper.around(ctx, () => inner(ctx, handler));
    };
  }
  return compile(0);
}
// C2W — C2 plus ctx.runInside(wrap): wrappers registered during the request enclose handler + onResponse.
function modelC2W() {
  const mws = [];
  for (let i = 0; i < MW; i++)
    mws.push(
      i < AROUND
        ? {
            async middleware(ctx) {
              if (ALS) {
                ctx.runInside((next) => store.run({ i }, next));
                return;
              }
              const t0 = performance.now();
              ctx.onResponse((res) => {
                ctx.state.t = performance.now() - t0;
                return res;
              });
            },
          }
        : {
            async middleware(ctx) {
              ctx.state[i] = true;
            },
          },
    );
  async function tail(ctx, handler) {
    let res = await handler(ctx);
    const cbs = ctx._onResponse;
    if (cbs)
      for (let i = cbs.length - 1; i >= 0; i--) {
        const r = await cbs[i](res);
        if (isResponse(r)) res = r;
      }
    return res;
  }
  return async (ctx, handler) => {
    for (let i = 0; i < mws.length; i++) {
      const r = await mws[i].middleware(ctx);
      if (isResponse(r)) return r;
    }
    const w = ctx._wrappers;
    if (!w) return tail(ctx, handler);
    let run = () => tail(ctx, handler);
    for (let i = w.length - 1; i >= 0; i--) {
      const inner = run;
      const wrap = w[i];
      run = () => wrap(inner);
    }
    return run();
  };
}
const models = {
  A: modelA,
  B: modelB,
  BL: modelBL,
  C1: modelC1,
  C2: modelC2,
  D: modelD,
  H: modelH,
  C2W: modelC2W,
  none: () => (ctx, handler) => handler(ctx),
};
const run = models[MODEL]();

function makeCtx() {
  const ctx = {
    state: {},
    _onResponse: undefined,
    _onFinish: undefined,
    _wrappers: undefined,
  };
  ctx.runInside = (wrap) => {
    (ctx._wrappers ??= []).push(wrap);
  };
  ctx.onResponse = (cb) => {
    (ctx._onResponse ??= []).push(cb);
  };
  ctx.onFinish = (cb) => {
    (ctx._onFinish ??= []).push(cb);
  };
  return ctx;
}
for (let i = 0; i < 3000; i++) await run(makeCtx(), async () => RESPONSE);

const samples = [];
for (let rep = 0; rep < 5; rep++) {
  const gates = new Array(N),
    ctxs = new Array(N),
    pending = new Array(N);
  for (let i = 0; i < N; i++) {
    let release;
    const p = new Promise((r) => {
      release = r;
    });
    gates[i] = { p, release };
    ctxs[i] = makeCtx();
  }
  const base = heap();
  for (let i = 0; i < N; i++)
    pending[i] = run(ctxs[i], async () => {
      await gates[i].p;
      return RESPONSE;
    });
  await new Promise((r) => setImmediate(r));
  const held = heap();
  samples.push((held - base) / N);
  for (const g of gates) g.release();
  await Promise.all(pending);
}
samples.sort((a, b) => a - b);
console.log(
  `${MODEL.padEnd(4)} ${MODE.padEnd(6)} MW=${MW} around=${AROUND}  retained/pending request: ${samples[2].toFixed(0).padStart(6)} B  (min ${samples[0].toFixed(0)}, max ${samples[4].toFixed(0)})`,
);
