// biome-ignore-all lint: experiment script kept as it was run; see ../README.md
// What goes wrong in an onion runner when `next()` is misused, and what a "safe" runner does.
// Also: AsyncLocalStorage from an `around` layer, and a transaction `finally` vs a lazy stream.
import { AsyncLocalStorage } from 'node:async_hooks';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isResponse = (v) =>
  v !== undefined && v !== null && typeof v === 'object' && 'status' in v;
let unhandled = 0;
process.on('unhandledRejection', () => {
  unhandled += 1;
});

// ── naive koa-compose style runner (production build: no guards) ──
function naive(mws, handler) {
  return (ctx) => {
    const dispatch = (i) => async () => {
      const fn = i === mws.length ? handler : mws[i];
      return fn(ctx, dispatch(i + 1));
    };
    return dispatch(0)();
  };
}
// ── "safe defaults" runner: auto-next, only a response stops, next() never throws, errors → registry
function resolveError(ctx, err) {
  ctx.error = err;
  return { status: err.status ?? 500, body: err.message };
}
function safe(mws, handler) {
  async function run(ctx, i) {
    if (i === mws.length) {
      try {
        return await handler(ctx);
      } catch (err) {
        return resolveError(ctx, err);
      }
    }
    let downstream;
    const next = () => {
      if (downstream) throw new Error('next() called twice');
      downstream = run(ctx, i + 1);
      return downstream;
    };
    let result;
    try {
      result = await mws[i](ctx, next);
    } catch (err) {
      result = resolveError(ctx, err);
    }
    if (downstream && isResponse(result)) {
      // returned own response while downstream may still be running: wait for it so nothing is lost
      ctx.warnings.push(
        `layer ${i} returned a response but next() was not awaited`,
      );
      await downstream;
      return result;
    }
    if (isResponse(result)) return result;
    return downstream ?? run(ctx, i + 1);
  }
  return (ctx) => run(ctx, 0);
}

async function scenario(name, fn) {
  const before = unhandled;
  const out = await fn();
  await sleep(5);
  console.log(
    `${name}\n   ${out}${unhandled > before ? `  ** ${unhandled - before} unhandledRejection **` : ''}`,
  );
}

const handlerCalls = { n: 0 };
const handler = async (ctx) => {
  handlerCalls.n += 1;
  await sleep(2);
  if (ctx.boom) throw Object.assign(new Error('boom'), { status: 418 });
  return { status: 200, body: 'ok' };
};

// 1. next() not awaited, own response returned
for (const [label, make] of [
  ['naive', naive],
  ['safe ', safe],
]) {
  await scenario(
    `1. [${label}] next() called, NOT awaited, middleware returns its own 403`,
    async () => {
      handlerCalls.n = 0;
      const run = make(
        [
          async (ctx, next) => {
            next();
            return { status: 403, body: 'no' };
          },
        ],
        handler,
      );
      const ctx = { warnings: [] };
      const res = await run(ctx);
      return `client gets ${res.status}; handler ran ${handlerCalls.n} time(s) anyway; warnings: ${JSON.stringify(ctx.warnings)}`;
    },
  );
}
// 2. next() not awaited, downstream throws
for (const [label, make] of [
  ['naive', naive],
  ['safe ', safe],
]) {
  await scenario(
    `2. [${label}] next() called, NOT awaited, handler throws`,
    async () => {
      const run = make(
        [
          async (ctx, next) => {
            next();
            return { status: 202, body: 'queued' };
          },
        ],
        handler,
      );
      const ctx = { warnings: [], boom: true };
      const res = await run(ctx);
      return `client gets ${res.status}; ctx.error=${ctx.error?.message ?? 'none'}`;
    },
  );
}
// 3. forgot `await` AND forgot return (returns undefined) — e.g. `next(); setHeader(...)`
for (const [label, make] of [
  ['naive', naive],
  ['safe ', safe],
]) {
  await scenario(
    `3. [${label}] next() called without await, nothing returned`,
    async () => {
      const run = make(
        [
          async (ctx, next) => {
            next();
            ctx.header = 'x';
          },
        ],
        handler,
      );
      const ctx = { warnings: [] };
      const res = await run(ctx);
      return `client gets ${res === undefined ? 'UNDEFINED (no response!)' : res.status}`;
    },
  );
}
// 4. double next
for (const [label, make] of [
  ['naive', naive],
  ['safe ', safe],
]) {
  await scenario(`4. [${label}] next() called twice`, async () => {
    handlerCalls.n = 0;
    const run = make(
      [
        async (ctx, next) => {
          await next();
          return next();
        },
      ],
      handler,
    );
    const ctx = { warnings: [] };
    try {
      const res = await run(ctx);
      return `client gets ${res?.status}; handler ran ${handlerCalls.n} time(s); ctx.error=${ctx.error?.message ?? 'none'}`;
    } catch (e) {
      return `runner threw: ${e.message}; handler ran ${handlerCalls.n} time(s)`;
    }
  });
}
// 5. the handler throws: who sees the error? (safe: next() never throws, error on ctx)
await scenario(
  '5. [safe ] try/catch around next() when the handler throws',
  async () => {
    const run = safe(
      [
        async (ctx, next) => {
          try {
            const r = await next();
            return r;
          } catch (e) {
            return `caught ${e.message}`;
          }
        },
      ],
      handler,
    );
    const ctx = { warnings: [], boom: true };
    const res = await run(ctx);
    return `middleware's catch did NOT run; next() resolved to the registry response ${res.status}; ctx.error=${ctx.error?.message}`;
  },
);
// 6. transaction finally vs lazy stream body, write AFTER the chain
await scenario(
  '6. [any  ] try/finally transaction around next(); handler returns a LAZY stream; writer runs after the chain',
  async () => {
    const log = [];
    const tx = { open: true };
    const run = safe(
      [
        async (ctx, next) => {
          try {
            return await next();
          } finally {
            tx.open = false;
            log.push('tx closed');
          }
        },
      ],
      async () => ({
        status: 200,
        body: {
          async *[Symbol.asyncIterator]() {
            log.push(`first chunk read, tx.open=${tx.open}`);
            yield 'a';
          },
        },
      }),
    );
    const res = await run({ warnings: [] });
    for await (const _ of res.body) {
      /* writer */
    }
    return log.join(' → ');
  },
);
// 7. ALS from an `around` layer: handler, deep service, response hook, finish hook
await scenario(
  '7. [onion/H] als.run(store, next) in a wrapping layer',
  async () => {
    const als = new AsyncLocalStorage();
    const seen = {};
    const run = safe(
      [
        async (ctx, next) => als.run({ user: 'alice' }, next),
        async (ctx, next) => {
          const r = await next();
          seen.outerAfter = als.getStore()?.user;
          return r;
        }, // runs INSIDE als.run
      ],
      async (ctx) => {
        seen.handler = als.getStore()?.user;
        await sleep(1);
        seen.service = als.getStore()?.user;
        ctx.onResponse = () => {
          seen.onResponseHook = als.getStore()?.user;
        };
        ctx.onFinish = () => {
          seen.onFinishHook = als.getStore()?.user;
        };
        return { status: 200 };
      },
    );
    const ctx = { warnings: [] };
    await run(ctx);
    ctx.onResponse(); // runner calls hooks after the chain → outside als.run
    setImmediate(() => ctx.onFinish());
    await sleep(5);
    return JSON.stringify(seen);
  },
);
