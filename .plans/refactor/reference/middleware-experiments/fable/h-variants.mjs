// biome-ignore-all lint: experiment script kept as it was run; see ../README.md
// H runner variants: how the runner treats around()'s return value changes retained memory.
//  Htail  : return wrapper.around(ctx, next)            (trusts around to return the response)
//  Hthen  : return wrapper.around(ctx, next).then(r => isResponse(r) ? r : downstream)  (auto-bubble, promise reaction)
//  Hawait : const r = await wrapper.around(ctx, next); ... (auto-bubble, suspended frame)
// usage: node --expose-gc h-variants.mjs <Htail|Hthen|Hawait> <MW> <AROUND> <N> [als]
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();
const [
  ,
  ,
  MODEL = 'Htail',
  MWs = '10',
  AROUNDs = '2',
  Ns = '10000',
  MODE = 'timing',
] = process.argv;
const ALS = MODE === 'als',
  MW = +MWs,
  AROUND = +AROUNDs,
  N = +Ns;
const RESPONSE = Object.freeze({ status: 200 });
const isResponse = (v) =>
  v !== undefined && v !== null && v.status !== undefined;
const heap = () => {
  global.gc();
  global.gc();
  return process.memoryUsage().heapUsed;
};
const mws = [];
for (let i = 0; i < MW; i++)
  mws.push(
    i < AROUND
      ? {
          async around(ctx, next) {
            if (ALS) return store.run({ i }, next);
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
    let downstream;
    const next = () => {
      if (downstream) throw new Error('twice');
      return (downstream = inner(ctx, handler));
    };
    if (MODEL === 'Htail') return wrapper.around(ctx, next);
    if (MODEL === 'Hthen')
      return wrapper
        .around(ctx, next)
        .then((r) => (isResponse(r) ? r : (downstream ?? inner(ctx, handler))));
    const r = await wrapper.around(ctx, next);
    if (isResponse(r)) return r;
    return downstream ?? inner(ctx, handler);
  };
}
const run = compile(0);
const makeCtx = () => ({ state: {} });
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
  `${MODEL.padEnd(7)} ${MODE.padEnd(6)} MW=${MW} around=${AROUND}  retained/pending request: ${samples[2].toFixed(0).padStart(6)} B (min ${samples[0].toFixed(0)}, max ${samples[4].toFixed(0)})`,
);
