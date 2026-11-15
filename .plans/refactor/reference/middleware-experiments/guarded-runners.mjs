// biome-ignore-all lint: experiment script kept as it was run; see README.md
// Retained heap per request pending in the handler for GUARDED runners: strict onion vs H.
// Guards: single-use next (second call throws), expiry (late call throws), result must be a
// branded response, downstream started but not returned is awaited before answering.
// 10 middleware = 8 ordinary steps + 2 wrappers that give the rest an own AsyncLocalStorage store.
// usage: node --expose-gc guarded-runners.mjs <onion|onion-guarded|onion-guarded-fast|h|h-guarded|h-guarded-fast> <sync|async> [N]
import { AsyncLocalStorage } from 'node:async_hooks';

const [, , MODEL, PREWORK = 'sync', Ns = '10000'] = process.argv;
const N = +Ns;
const STEPS = 8;
const WRAPS = 2;
const BRAND = Symbol('response');
const RESPONSE = Object.freeze({ [BRAND]: true, status: 200 });
const isResponse = (v) =>
  v !== null && typeof v === 'object' && v[BRAND] === true;
const store = new AsyncLocalStorage();
const gc =
  globalThis.gc ?? (typeof Bun !== 'undefined' ? () => Bun.gc(true) : null);
const heap = () => {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
};
const ASYNC = PREWORK === 'async';

// ── the same middleware, written for each contract ──
const onionSteps = Array.from({ length: STEPS }, (_, i) =>
  ASYNC
    ? async (ctx, next) => {
        await null;
        ctx.state[i] = true;
        return next();
      }
    : (ctx, next) => {
        ctx.state[i] = true;
        return next();
      },
);
const onionWraps = Array.from(
  { length: WRAPS },
  (_, i) => (ctx, next) => store.run({ i }, next),
);
const hSteps = Array.from({ length: STEPS }, (_, i) =>
  ASYNC
    ? async (ctx) => {
        await null;
        ctx.state[i] = true;
      }
    : (ctx) => {
        ctx.state[i] = true;
      },
);
const hWraps = onionWraps;
// order: wrapper, 4 steps, wrapper, 4 steps (wrappers early, as UserScope/Tracing would be)
const order = ['w', 's', 's', 's', 's', 'w', 's', 's', 's', 's'];

// ── strict onion ──
function onion(guarded, fast = false) {
  const mws = [];
  let si = 0,
    wi = 0;
  for (const k of order)
    mws.push(k === 'w' ? onionWraps[wi++] : onionSteps[si++]);
  function invoke(i, ctx, handler) {
    if (i === mws.length) return handler(ctx);
    if (!guarded) return mws[i](ctx, () => invoke(i + 1, ctx, handler));
    let state = 0; // 0 open, 1 called, 2 expired
    let downstream;
    const next = () => {
      if (state !== 0)
        throw new Error(
          state === 1 ? 'next() called twice' : 'next() called late',
        );
      state = 1;
      return (downstream = invoke(i + 1, ctx, handler));
    };
    let result;
    try {
      result = mws[i](ctx, next);
    } catch (err) {
      state = 2;
      if (downstream)
        return downstream.then(
          () => {
            throw err;
          },
          () => {
            throw err;
          },
        );
      throw err;
    }
    // Fast path: a synchronous `return next()` hands back the downstream promise itself. The inner
    // layer already validates it and next() is spent, so no reaction is needed here.
    if (fast && result === downstream) return result;
    return Promise.resolve(result).then(
      (r) => {
        state = 2;
        if (!isResponse(r))
          throw new TypeError(`middleware ${i} must return a response`);
        return downstream
          ? downstream.then(
              () => r,
              () => r,
            )
          : r;
      },
      (err) => {
        state = 2;
        if (downstream)
          return downstream.then(
            () => {
              throw err;
            },
            () => {
              throw err;
            },
          );
        throw err;
      },
    );
  }
  return (ctx, handler) => invoke(0, ctx, handler);
}

// ── H: stages in flat loops, only wrappers get next ──
function hybrid(guarded, fast = false) {
  // compile: segments of steps separated by wrappers
  function compile(pos) {
    const steps = [];
    let j = pos;
    let si = order.slice(0, pos).filter((k) => k === 's').length;
    let wi = order.slice(0, pos).filter((k) => k === 'w').length;
    while (j < order.length && order[j] === 's') {
      steps.push(hSteps[si++]);
      j++;
    }
    const wrapper = j < order.length ? hWraps[wi] : null;
    const inner = wrapper ? compile(j + 1) : null;
    const runSteps = ASYNC
      ? async (ctx) => {
          for (const s of steps) {
            const r = await s(ctx);
            if (r !== undefined) {
              if (isResponse(r)) return r;
              throw new TypeError('bad step result');
            }
          }
        }
      : (ctx) => {
          for (const s of steps) {
            const r = s(ctx);
            if (r !== undefined) {
              if (isResponse(r)) return r;
              throw new TypeError('bad step result');
            }
          }
        };
    const afterSteps = (ctx, handler, stopped) => {
      if (stopped) return stopped;
      if (!wrapper) return handler(ctx);
      if (!guarded) return wrapper(ctx, () => inner(ctx, handler));
      let state = 0;
      let downstream;
      const next = () => {
        if (state !== 0)
          throw new Error(
            state === 1 ? 'next() called twice' : 'next() called late',
          );
        state = 1;
        return (downstream = inner(ctx, handler));
      };
      let result;
      try {
        result = wrapper(ctx, next);
      } catch (err) {
        state = 2;
        if (downstream)
          return downstream.then(
            () => {
              throw err;
            },
            () => {
              throw err;
            },
          );
        throw err;
      }
      if (fast && result === downstream) return result; // same fast path as the onion
      return Promise.resolve(result).then(
        (r) => {
          state = 2;
          if (!isResponse(r))
            throw new TypeError('around must return a response');
          return downstream
            ? downstream.then(
                () => r,
                () => r,
              )
            : r;
        },
        (err) => {
          state = 2;
          if (downstream)
            return downstream.then(
              () => {
                throw err;
              },
              () => {
                throw err;
              },
            );
          throw err;
        },
      );
    };
    return ASYNC
      ? (ctx, handler) =>
          runSteps(ctx).then((stopped) => afterSteps(ctx, handler, stopped))
      : (ctx, handler) => afterSteps(ctx, handler, runSteps(ctx));
  }
  return compile(0);
}

const models = {
  onion: () => onion(false),
  'onion-guarded': () => onion(true),
  'onion-guarded-fast': () => onion(true, true),
  h: () => hybrid(false),
  'h-guarded': () => hybrid(true),
  'h-guarded-fast': () => hybrid(true, true),
};
const run = models[MODEL]();

// correctness: the handler sees the innermost wrapper's store; answers RESPONSE
{
  const seen = await run({ state: {} }, async () => {
    await null;
    return store.getStore()?.i === 1 ? RESPONSE : null;
  });
  if (seen !== RESPONSE)
    throw new Error(`${MODEL}: handler did not see the wrapper store`);
}
for (let i = 0; i < 3000; i++) await run({ state: {} }, async () => RESPONSE);

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
    ctxs[i] = { state: {} };
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
const runtime =
  typeof Bun === 'undefined' ? `node ${process.version}` : `bun ${Bun.version}`;
console.log(
  `${runtime} ${MODEL.padEnd(14)} ${PREWORK.padEnd(5)} retained/pending request: ${samples[2].toFixed(0).padStart(5)} B  (min ${samples[0].toFixed(0)}, max ${samples[4].toFixed(0)})`,
);
