// biome-ignore-all lint: experiment script kept as it was run; see ../README.md
// Retained heap per request that is ACTIVELY STREAMING (headers sent, body suspended),
// for each flow model, and for the two places where the write can happen:
//   after  = the chain unwinds, then the runner writes (Koa style; the "transaction finally runs
//            before the stream is read" case)
//   inside = the writer runs inside the innermost layer, so an outer `await next()` only returns
//            after the last byte (frames of wrapping middleware stay alive during the stream)
// usage: node --expose-gc stream-retained.mjs <stages|onion-after|onion-inside|H-after|H-inside|none> <MW> <AROUND> <N>
const [, , MODEL = 'stages', MWs = '10', AROUNDs = '2', Ns = '5000'] =
  process.argv;
const MW = +MWs,
  AROUND = +AROUNDs,
  N = +Ns;
const isResponse = (v) =>
  v !== undefined && v !== null && v.status !== undefined;
const heap = () => {
  global.gc();
  global.gc();
  return process.memoryUsage().heapUsed;
};

// A fake transport: counts chunks, fires onFinish callbacks when the body is consumed.
function makeRes() {
  return { chunks: 0, finished: false };
}
async function write(ctx, response) {
  // headers "sent" with the first chunk, like ExpressResponseWriter.writeStream
  for await (const chunk of response.body) ctx.res.chunks += chunk.length;
  ctx.res.finished = true;
  const cbs = ctx._onFinish;
  if (cbs) for (const cb of cbs) cb();
}

function makeMiddlewares(kind) {
  const mws = [];
  for (let i = 0; i < MW; i++) {
    const wraps = i < AROUND;
    if (kind === 'stages') {
      mws.push(
        wraps
          ? async (ctx) => {
              const t0 = performance.now();
              ctx.onFinish(() => {
                ctx.state.t = performance.now() - t0;
              });
            }
          : async (ctx) => {
              ctx.state[i] = true;
            },
      );
    } else if (kind === 'onion') {
      mws.push(
        wraps
          ? async (ctx, next) => {
              const t0 = performance.now();
              const r = await next();
              ctx.state.t = performance.now() - t0;
              return r;
            }
          : async (ctx) => {
              ctx.state[i] = true;
            },
      );
    } else if (kind === 'H') {
      mws.push(
        wraps
          ? {
              async around(ctx, next) {
                const t0 = performance.now();
                const r = await next();
                ctx.state.t = performance.now() - t0;
                return r;
              },
            }
          : {
              async run(ctx) {
                ctx.state[i] = true;
              },
            },
      );
    }
  }
  return mws;
}

// stages: flat loop, write after, onFinish
function stages() {
  const mws = makeMiddlewares('stages');
  return async (ctx, handler) => {
    let res;
    for (let i = 0; i < mws.length; i++) {
      const r = await mws[i](ctx);
      if (isResponse(r)) {
        res = r;
        break;
      }
    }
    if (!res) res = await handler(ctx);
    return write(ctx, res);
  };
}
// onion with safe defaults (auto-next); `inside` puts the writer in the terminal layer
function onion(inside) {
  const mws = makeMiddlewares('onion');
  async function run(ctx, handler, i) {
    if (i === mws.length) {
      const res = await handler(ctx);
      if (inside) {
        await write(ctx, res);
        return undefined;
      }
      return res;
    }
    let downstream;
    const next = () => {
      if (downstream) throw new Error('twice');
      downstream = run(ctx, handler, i + 1);
      return downstream;
    };
    const result = await mws[i](ctx, next);
    if (isResponse(result)) return result;
    return downstream ?? run(ctx, handler, i + 1);
  }
  return async (ctx, handler) => {
    const res = await run(ctx, handler, 0);
    if (!inside) await write(ctx, res);
  };
}
// hybrid by declaration, composed once
function hybrid(inside) {
  const mws = makeMiddlewares('H');
  function compile(i) {
    const stagesList = [];
    let j = i;
    while (j < mws.length && !mws[j].around) stagesList.push(mws[j++]);
    const wrapper = j < mws.length ? mws[j] : null;
    const inner = wrapper ? compile(j + 1) : null;
    return async (ctx, handler) => {
      for (let k = 0; k < stagesList.length; k++) {
        const r = await stagesList[k].run(ctx);
        if (isResponse(r)) return r;
      }
      if (!wrapper) {
        const res = await handler(ctx);
        if (inside) {
          await write(ctx, res);
          return undefined;
        }
        return res;
      }
      return wrapper.around(ctx, () => inner(ctx, handler));
    };
  }
  const chain = compile(0);
  return async (ctx, handler) => {
    const res = await chain(ctx, handler);
    if (!inside) await write(ctx, res);
  };
}
const models = {
  none: () => async (ctx, handler) => write(ctx, await handler(ctx)),
  stages,
  'onion-after': () => onion(false),
  'onion-inside': () => onion(true),
  'H-after': () => hybrid(false),
  'H-inside': () => hybrid(true),
};
const run = models[MODEL]();
function makeCtx() {
  const ctx = { state: {}, res: makeRes(), _onFinish: undefined };
  ctx.onFinish = (cb) => {
    (ctx._onFinish ??= []).push(cb);
  };
  return ctx;
}
const CHUNK = new Uint8Array(8);
// Body whose first chunk waits on a gate: the request is suspended INSIDE the write.
function body(gate) {
  return {
    async *[Symbol.asyncIterator]() {
      await gate.p;
      yield CHUNK;
      yield CHUNK;
    },
  };
}
for (let i = 0; i < 2000; i++) {
  const g = { p: Promise.resolve() };
  await run(makeCtx(), async () => ({
    status: 200,
    headers: [],
    body: body(g),
  }));
}
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
    pending[i] = run(ctxs[i], async () => ({
      status: 200,
      headers: [],
      body: body(gates[i]),
    }));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const held = heap();
  samples.push((held - base) / N);
  for (const g of gates) g.release();
  await Promise.all(pending);
  if (ctxs.some((c) => !c.res.finished || c.res.chunks !== 16))
    throw new Error('stream not fully written');
}
samples.sort((a, b) => a - b);
console.log(
  `${MODEL.padEnd(13)} MW=${MW} around=${AROUND} streaming, retained/in-flight request: ${samples[2].toFixed(0).padStart(6)} B (min ${samples[0].toFixed(0)}, max ${samples[4].toFixed(0)})`,
);
