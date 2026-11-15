// biome-ignore-all lint: experiment script kept as it was run; see README.md
// Strict onion vs H, checked against the requirements and measured on realistic route mixes.
//
// Runner modes (both models):
//   raw  — no guards (koa-compose production style)
//   safe — production guards (revised after the review of 2026-11-01): next() always returns a
//          Promise; it works once; it is refused once its own middleware call has settled
//          (per-invocation expiry) or the request has chosen its response; every started suffix
//          is recorded, the runner waits for all of them (handler, later middleware, wrapper
//          cleanup) before answering, and none can become an unhandledRejection; the final value
//          must be a response (generic error)
//   dev  — safe + every layer's result checked, naming the middleware that broke the rule
//
// usage:
//   node contract-check.mjs conformance
//   node --expose-gc contract-check.mjs memory     (fresh process per cell)
//   node contract-check.mjs cpu                     (fresh process per cell)
//   bun  contract-check.mjs <same>

import { AsyncLocalStorage } from 'node:async_hooks';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RUNTIME =
  typeof Bun === 'undefined' ? `node ${process.version}` : `bun ${Bun.version}`;
const BRAND = Symbol.for('experiment.response');
const response = (status, body) =>
  Object.freeze({ [BRAND]: true, status, body });
const isResponse = (v) =>
  v !== null && typeof v === 'object' && v[BRAND] === true;
const OK = response(200, { ok: true });
const noop = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => sleep(1 + Math.floor(Math.random() * 4));
const userStore = new AsyncLocalStorage();

// ───────────────────────── runners ─────────────────────────

function callHandler(ctx, handler) {
  try {
    return Promise.resolve(handler(ctx));
  } catch (err) {
    return Promise.reject(err);
  }
}

// A refused or failed start must never become an unhandledRejection.
function rejected(err) {
  const p = Promise.reject(err);
  p.then(undefined, noop);
  return p;
}

// Shared top-level settle: mark the request decided, wait for every started suffix (handler,
// later middleware, wrapper cleanup), then check the result.
function finish(req, failed, value) {
  req.settled = true;
  const done = () => {
    if (req.misuse) throw req.misuse;
    if (failed) throw value;
    if (!isResponse(value))
      throw new TypeError('the middleware chain did not return a response');
    return value;
  };
  return req.started.length
    ? Promise.allSettled(req.started).then(done)
    : done();
}

// Misuse is refused with a rejected Promise that cannot become an unhandledRejection. A second
// call while the request runs also fails the request; a late call (after its middleware already
// finished) is only refused — the response that middleware chose stands.
function refuse(req, name, message, failRequest) {
  const err = new Error(`${name}: ${message}`);
  if (failRequest && !req.settled) req.misuse ??= err;
  return rejected(err);
}

const isThenable = (v) =>
  v !== null && typeof v === 'object' && typeof v.then === 'function';

/**
 * One continuation-taking layer with the production guards (review 2026-11-01): next() always
 * returns a Promise; it works once; it is refused once this layer's own call has settled
 * (per-invocation expiry) or the request has chosen its response; every started suffix is
 * recorded so the runner waits for it. Rejections are handled where they are created (handler,
 * failed start, layer result), so misuse never leaves an unhandledRejection.
 * `dev` additionally checks this layer's result and names it.
 */
function guardedLayer(req, name, fn, ctx, suffix, dev) {
  let state = 0; // 0 open, 1 next() called, 2 this call settled
  let downstream;
  const next = () => {
    if (state === 1) return refuse(req, name, 'next() called twice', true);
    if (state === 2 || req.settled)
      return refuse(
        req,
        name,
        'next() called after its middleware finished',
        false,
      );
    state = 1;
    try {
      downstream = Promise.resolve(suffix());
    } catch (err) {
      downstream = rejected(err);
    }
    req.started.push(downstream);
    return downstream;
  };
  let result;
  try {
    result = fn(ctx, next);
  } catch (err) {
    state = 2;
    throw err;
  }
  if (!isThenable(result)) {
    // A synchronous return settles this call now.
    state = 2;
    if (dev && !isResponse(result))
      throw new TypeError(
        `${name} must return a response (missing "return next()"?)`,
      );
    return result;
  }
  if (result === downstream && !dev) {
    // `return next()`: this call settles with its suffix; next() is already spent.
    return result;
  }
  if (!dev) {
    const expire = () => {
      state = 2;
    };
    result.then(expire, expire); // also marks the layer's own result handled
    return result;
  }
  return result.then(
    (r) => {
      state = 2;
      if (!isResponse(r))
        throw new TypeError(
          `${name} must return a response (missing "return next()"?)`,
        );
      return r;
    },
    (err) => {
      state = 2;
      throw err;
    },
  );
}

function guardedHandler(ctx, handler) {
  const p = callHandler(ctx, handler);
  p.then(undefined, noop); // a misused next() must not leave the handler's rejection unhandled
  return p;
}

const newRequestState = () => ({ settled: false, started: [] });

function topLevel(chain) {
  return (ctx) => {
    const req = newRequestState();
    let top;
    try {
      top = Promise.resolve(chain(ctx, req));
    } catch (err) {
      top = Promise.reject(err);
    }
    return top.then(
      (v) => finish(req, false, v),
      (e) => finish(req, true, e),
    );
  };
}

/** Strict onion: every middleware is (ctx, next) => response. */
function onion(mws, handler, mode) {
  const n = mws.length;
  if (mode === 'raw') {
    const invoke = (ctx, i) =>
      i === n ? handler(ctx) : mws[i].onion(ctx, () => invoke(ctx, i + 1));
    return (ctx) => {
      try {
        return Promise.resolve(invoke(ctx, 0));
      } catch (err) {
        return Promise.reject(err);
      }
    };
  }
  const dev = mode === 'dev';
  const invoke = (ctx, req, i) => {
    if (i === n) return guardedHandler(ctx, handler);
    const mw = mws[i];
    return guardedLayer(
      req,
      mw.name,
      mw.onion,
      ctx,
      () => invoke(ctx, req, i + 1),
      dev,
    );
  };
  return topLevel((ctx, req) => invoke(ctx, req, 0));
}

/** H: stages (ctx) => void | response, wrappers around(ctx, next) => response; composed once. */
function hybrid(mws, handler, mode) {
  const dev = mode === 'dev';
  const compile = (pos) => {
    const stages = [];
    let j = pos;
    while (j < mws.length && mws[j].stage) stages.push(mws[j++]);
    const wrapper = j < mws.length ? mws[j] : null;
    const inner = wrapper ? compile(j + 1) : null;
    const rest = (ctx, req) => {
      if (!wrapper)
        return mode === 'raw'
          ? callHandler(ctx, handler)
          : guardedHandler(ctx, handler);
      if (mode === 'raw') return wrapper.around(ctx, () => inner(ctx, req));
      return guardedLayer(
        req,
        wrapper.name,
        wrapper.around,
        ctx,
        () => inner(ctx, req),
        dev,
      );
    };
    if (stages.length === 0) return rest;
    // One async loop per segment: a stage's frame is gone before the handler waits.
    return async (ctx, req) => {
      for (let k = 0; k < stages.length; k++) {
        let r = stages[k].stage(ctx);
        if (r !== undefined && typeof r.then === 'function') r = await r;
        if (r === undefined) continue;
        if (isResponse(r)) return r;
        throw new TypeError(
          `${stages[k].name} returned something that is not a response`,
        );
      }
      return rest(ctx, req);
    };
  };
  const chain = compile(0);
  if (mode === 'raw') {
    return (ctx) => {
      try {
        return Promise.resolve(chain(ctx, null));
      } catch (err) {
        return Promise.reject(err);
      }
    };
  }
  return topLevel(chain);
}

const build = (model, mws, handler, mode) =>
  (model === 'onion' ? onion : hybrid)(mws, handler, mode);

// ───────────────────────── middleware ─────────────────────────
// Each kind is written for both contracts. "async" stands for GetUserByToken, RateLimiter,
// RequestParser, I18n (they await); "sync" for Auth, Role, Cors, Pagination, PrepareAppInfo.

function kinds(wait) {
  return {
    sync: (i) => ({
      name: `Sync${i}`,
      onion: (ctx, next) => {
        ctx.state.n++;
        return next();
      },
      stage: (ctx) => {
        ctx.state.n++;
      },
    }),
    async: (i) => ({
      name: `Async${i}`,
      onion: async (ctx, next) => {
        await wait();
        ctx.state.n++;
        return next();
      },
      stage: async (ctx) => {
        await wait();
        ctx.state.n++;
      },
    }),
    scope: (i) => {
      const around = (ctx, next) => userStore.run(ctx.user, next);
      return { name: `UserScope${i}`, onion: around, around };
    },
    tx: (i) => {
      const around = async (ctx, next) => {
        ctx.tx.open++;
        try {
          const r = await next();
          ctx.tx.commit++;
          return r;
        } catch (err) {
          ctx.tx.rollback++;
          throw err;
        } finally {
          ctx.tx.open--;
        }
      };
      return { name: `Transaction${i}`, onion: around, around };
    },
  };
}
const makeMws = (spec, wait) => spec.map((k, i) => kinds(wait)[k](i));
const makeCtx = (id = 0) => ({
  id,
  user: `user-${id}`,
  state: { n: 0 },
  tx: { open: 0, commit: 0, rollback: 0 },
});

const SCENARIOS = {
  // 2 sync checks (Auth + Role)
  minimal: ['sync', 'sync'],
  // RequestParser, I18n, GetUserByToken, Auth, Role, RateLimiter
  typical: ['async', 'async', 'async', 'sync', 'sync', 'async'],
  // + UserScope (own AsyncLocalStorage store for the rest)
  'typical+scope': [
    'async',
    'async',
    'async',
    'sync',
    'sync',
    'scope',
    'async',
  ],
  // + Transaction (try/catch/finally around the rest)
  'typical+scope+tx': [
    'async',
    'async',
    'async',
    'sync',
    'sync',
    'scope',
    'async',
    'tx',
  ],
  // 8 async + 2 wrappers (the earlier harnesses' shape)
  heavy: [
    'scope',
    'async',
    'async',
    'async',
    'async',
    'scope',
    'async',
    'async',
    'async',
    'async',
  ],
};

// ───────────────────────── conformance ─────────────────────────

async function conformance() {
  const unhandled = [];
  process.on('unhandledRejection', (e) => unhandled.push(e));
  const timerKinds = kinds(jitter);
  const cases = [];
  const add = (name, fn) => cases.push({ name, fn });
  const outcome = async (p) => {
    try {
      return { value: await p };
    } catch (error) {
      return { error };
    }
  };
  // a custom middleware written for both contracts
  const custom = (name, onionFn, h) => ({ name, onion: onionFn, ...h });

  add('R1 early response stops the chain (Role → 403)', async (model, mode) => {
    let handlerRuns = 0;
    const deny = custom('Role', () => response(403, {}), {
      stage: () => response(403, {}),
    });
    const run = build(
      model,
      [timerKinds.async(0), deny, timerKinds.async(2)],
      () => (handlerRuns++, OK),
      mode,
    );
    const r = await outcome(run(makeCtx()));
    return r.value?.status === 403 && handlerRuns === 0;
  });

  add('R2 after-part sees and replaces the response', async (model, mode) => {
    const wrap = async (ctx, next) => {
      const r = await next();
      return response(r.status, { ...r.body, wrapped: true });
    };
    const run = build(
      model,
      [custom('Wrap', wrap, { around: wrap }), timerKinds.async(1)],
      () => OK,
      mode,
    );
    const r = await outcome(run(makeCtx()));
    return r.value?.body.wrapped === true;
  });

  add(
    'R4 own store reaches later middleware, handler, deep code (40 concurrent)',
    async (model, mode) => {
      const read = custom(
        'ReadStore',
        async (ctx, next) => {
          await jitter();
          ctx.seenLater = userStore.getStore();
          return next();
        },
        {
          stage: async (ctx) => {
            await jitter();
            ctx.seenLater = userStore.getStore();
          },
        },
      );
      const service = async () => {
        await jitter();
        return userStore.getStore();
      };
      const run = build(
        model,
        [timerKinds.async(0), timerKinds.scope(1), read, timerKinds.async(3)],
        async (ctx) => {
          ctx.seenHandler = userStore.getStore();
          ctx.seenService = await service();
          return OK;
        },
        mode,
      );
      const ctxs = Array.from({ length: 40 }, (_, i) => makeCtx(i));
      await Promise.all(ctxs.map((c) => run(c)));
      return ctxs.every(
        (c) =>
          c.seenLater === c.user &&
          c.seenHandler === c.user &&
          c.seenService === c.user,
      );
    },
  );

  add(
    'R6 handler throws → transaction rolls back, original error reaches the top',
    async (model, mode) => {
      const boom = new Error('boom');
      const ctx = makeCtx();
      const run = build(
        model,
        [timerKinds.tx(0), timerKinds.async(1)],
        async () => {
          await jitter();
          throw boom;
        },
        mode,
      );
      const r = await outcome(run(ctx));
      return (
        r.error === boom &&
        ctx.tx.rollback === 1 &&
        ctx.tx.commit === 0 &&
        ctx.tx.open === 0
      );
    },
  );

  add(
    'R6 success → commit; non-Error throw passes through unchanged',
    async (model, mode) => {
      const ctx = makeCtx();
      const ok = await outcome(
        build(model, [timerKinds.tx(0)], () => OK, mode)(ctx),
      );
      const ctx2 = makeCtx();
      const prim = await outcome(
        build(
          model,
          [timerKinds.tx(0)],
          () => {
            throw 'plain string';
          },
          mode,
        )(ctx2),
      );
      return (
        ok.value === OK &&
        ctx.tx.commit === 1 &&
        prim.error === 'plain string' &&
        ctx2.tx.rollback === 1
      );
    },
  );

  add(
    'R5 tracing span of a middleware parents the handler span (real OTel)',
    async (model, mode) => {
      const otel = loadOtel();
      if (!otel) return 'skipped';
      const { tracer, exporter, api } = otel;
      exporter.reset();
      const span = async (ctx, next) => {
        return tracer.startActiveSpan('middleware span', async (s) => {
          try {
            return await next();
          } finally {
            s.end();
          }
        });
      };
      const run = build(
        model,
        [custom('Tracing', span, { around: span }), timerKinds.async(1)],
        async () => {
          const s = tracer.startSpan('handler work');
          await jitter();
          s.end();
          return OK;
        },
        mode,
      );
      await run(makeCtx());
      const spans = exporter.getFinishedSpans();
      const parent = spans.find((s) => s.name === 'middleware span');
      const child = spans.find((s) => s.name === 'handler work');
      return Boolean(
        parent &&
          child &&
          child.parentSpanContext?.spanId === parent.spanContext().spanId,
      );
    },
  );

  add(
    'Misuse: next() called twice → error, handler runs once',
    async (model, mode) => {
      let runs = 0;
      const twice = async (ctx, next) => {
        const a = next();
        next();
        return a;
      };
      const r = await outcome(
        build(
          model,
          [custom('Twice', twice, { around: twice })],
          async () => {
            runs++;
            await jitter();
            return OK;
          },
          mode,
        )(makeCtx()),
      );
      await sleep(20);
      return mode === 'raw'
        ? `handler ran ${runs}×`
        : Boolean(r.error && /twice/.test(r.error.message) && runs === 1);
    },
  );

  add(
    'Misuse: next() not awaited, other response returned, handler throws later',
    async (model, mode) => {
      const before = unhandled.length;
      let handlerDone = false;
      let doneAtAnswer;
      const early = async (ctx, next) => {
        next();
        return response(202, {});
      };
      const r = await outcome(
        build(
          model,
          [custom('Early', early, { around: early })],
          async () => {
            await sleep(10);
            handlerDone = true;
            throw new Error('late failure');
          },
          mode,
        )(makeCtx()).then((v) => ((doneAtAnswer = handlerDone), v)),
      );
      await sleep(30);
      const noUnhandled = unhandled.length === before;
      if (mode === 'raw')
        return `answered before handler finished: ${!doneAtAnswer}; unhandled rejection: ${!noUnhandled}`;
      return r.value?.status === 202 && doneAtAnswer === true && noUnhandled;
    },
  );

  add(
    'Misuse: stored next() called after the response was chosen',
    async (model, mode) => {
      let runs = 0;
      const ctx = makeCtx();
      const late = (c, next) => {
        setTimeout(() => {
          Promise.resolve()
            .then(() => next())
            .catch((e) => {
              c.lateError = e.message;
            });
        }, 5);
        return response(200, {});
      };
      await outcome(
        build(
          model,
          [custom('Late', late, { around: late })],
          () => (runs++, OK),
          mode,
        )(ctx),
      );
      await sleep(30);
      return mode === 'raw'
        ? `handler ran ${runs}× after the answer`
        : runs === 0 &&
            /after its middleware finished/.test(ctx.lateError ?? '');
    },
  );

  add(
    'Misuse: forgotten return (await next() without return)',
    async (model, mode) => {
      const forgot = async (ctx, next) => {
        await next();
      };
      const r = await outcome(
        build(
          model,
          [custom('Forgot', forgot, { around: forgot }), timerKinds.async(1)],
          () => OK,
          mode,
        )(makeCtx()),
      );
      if (mode === 'raw')
        return `result: ${r.value === undefined && !r.error ? 'undefined (no response)' : 'other'}`;
      if (mode === 'dev')
        return Boolean(
          r.error && /Forgot must return a response/.test(r.error.message),
        );
      return Boolean(r.error instanceof TypeError);
    },
  );

  add('Misuse: throw after an un-awaited next()', async (model, mode) => {
    const before = unhandled.length;
    let handlerDone = false;
    let doneAtAnswer;
    const thrower = async (ctx, next) => {
      next();
      throw new Error('middleware failed');
    };
    const r = await outcome(
      build(
        model,
        [custom('Thrower', thrower, { around: thrower })],
        async () => {
          await sleep(10);
          handlerDone = true;
          return OK;
        },
        mode,
      )(makeCtx()).finally(() => (doneAtAnswer = handlerDone)),
    );
    await sleep(30);
    if (mode === 'raw')
      return `answered before handler finished: ${!doneAtAnswer}`;
    return (
      r.error?.message === 'middleware failed' &&
      doneAtAnswer === true &&
      unhandled.length === before
    );
  });

  add(
    'R8 lazy stream body is read after the transaction closed (documented rule)',
    async (model, mode) => {
      const ctx = makeCtx();
      const run = build(
        model,
        [timerKinds.tx(0)],
        (c) =>
          response(200, {
            async *[Symbol.asyncIterator]() {
              yield `tx open while streaming: ${c.tx.open > 0}`;
            },
          }),
        mode,
      );
      const r = await run(ctx);
      for await (const chunk of r.body) return chunk;
    },
  );

  // Cases from the contract review (2026-11-01), mirrored from contract-review-probes.mjs.
  add(
    'Guard: waits for started downstream cleanup before answering',
    async (model, mode) => {
      let release;
      const cleanup = new Promise((r) => {
        release = r;
      });
      let cleaned = false;
      let answered = false;
      const drop = (_ctx, next) => {
        next();
        return response(202, {});
      };
      const tidy = async (_ctx, next) => {
        try {
          return await next();
        } finally {
          await cleanup;
          cleaned = true;
        }
      };
      const pending = build(
        model,
        [
          custom('Drop', drop, { around: drop }),
          custom('Cleanup', tidy, { around: tidy }),
        ],
        () => OK,
        mode,
      )(makeCtx()).then((v) => {
        answered = true;
        return v;
      });
      await sleep(5);
      const early = answered;
      release();
      const r = await outcome(pending);
      if (mode === 'raw') return `answered before cleanup: ${early}`;
      return !early && cleaned && r.value?.status === 202;
    },
  );

  add(
    'Guard: a finished middleware cannot start its discarded suffix',
    async (model, mode) => {
      let saved;
      let runs = 0;
      let release;
      const outerGate = new Promise((r) => {
        release = r;
      });
      const outer = async (_ctx, next) => {
        const v = await next();
        await outerGate;
        return v;
      };
      const short = (_ctx, next) => {
        saved = next;
        return response(403, {});
      };
      const pending = outcome(
        build(
          model,
          [
            custom('Outer', outer, { around: outer }),
            custom('Short', short, { around: short }),
          ],
          () => (runs++, OK),
          mode,
        )(makeCtx()),
      );
      await sleep(5);
      let refused = false;
      try {
        await saved();
      } catch {
        refused = true;
      }
      release();
      const r = await pending;
      if (mode === 'raw') return `handler ran ${runs}× though 403 was chosen`;
      return refused && runs === 0 && r.value?.status === 403;
    },
  );

  add(
    'Guard: next() returns a Promise (sync early response and sync error)',
    async (model, mode) => {
      const consume = (_ctx, next) => next().then((r) => r);
      const deny = () => response(403, {});
      const fail = () => {
        throw new Error('sync failure');
      };
      const a = await outcome(
        build(
          model,
          [
            custom('Consumer', consume, { around: consume }),
            custom('Deny', deny, { around: deny }),
          ],
          () => OK,
          mode,
        )(makeCtx()),
      );
      const b = await outcome(
        build(
          model,
          [
            custom('Consumer', consume, { around: consume }),
            custom('Fail', fail, { around: fail }),
          ],
          () => OK,
          mode,
        )(makeCtx()),
      );
      if (mode === 'raw')
        return `early: ${a.value?.status ?? a.error?.message}; error: ${b.error?.message}`;
      return a.value?.status === 403 && b.error?.message === 'sync failure';
    },
  );

  const results = [];
  for (const { name, fn } of cases) {
    const row = { case: name };
    for (const model of ['onion', 'hybrid'])
      for (const mode of ['raw', 'safe', 'dev'])
        row[`${model}/${mode}`] = await fn(model, mode);
    results.push(row);
  }
  const failures = results.flatMap((row) =>
    Object.entries(row)
      .filter(([k, v]) => /\/(safe|dev)$/.test(k) && v === false)
      .map(([k]) => `${row.case} — ${k}`),
  );
  const skipped = results.flatMap((row) =>
    Object.entries(row)
      .filter(([k, v]) => /\/(safe|dev)$/.test(k) && v === 'skipped')
      .map(([k]) => `${row.case} — ${k}`),
  );
  console.log(
    JSON.stringify(
      { runtime: RUNTIME, conformance: results, failures, skipped },
      null,
      2,
    ),
  );
  if (failures.length) process.exitCode = 1;
}

let otelCache;
function loadOtel() {
  if (otelCache !== undefined) return otelCache;
  try {
    const dir =
      process.env.OTEL_DIR ??
      '/tmp/claude-0/-home-user/9696e70e-b2d3-5bd7-b2c5-f119416e5a4d/scratchpad/otel-test';
    const req = createRequire(`${dir}/package.json`);
    const { NodeTracerProvider } = req('@opentelemetry/sdk-trace-node');
    const { SimpleSpanProcessor, InMemorySpanExporter } = req(
      '@opentelemetry/sdk-trace-base',
    );
    const api = req('@opentelemetry/api');
    const exporter = new InMemorySpanExporter();
    new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    }).register();
    otelCache = { tracer: api.trace.getTracer('check'), exporter, api };
  } catch {
    otelCache = null;
  }
  return otelCache;
}

// ───────────────────────── memory and CPU (one cell per process) ─────────────────────────

const gc =
  globalThis.gc ?? (typeof Bun !== 'undefined' ? () => Bun.gc(true) : null);
const heap = () => {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
};

async function memoryCell({ model, mode, scenario, N }) {
  const mws = makeMws(SCENARIOS[scenario], () => null);
  const run = build(model, mws, (ctx) => ctx.gate.then(() => OK), mode);
  const ready = Promise.resolve();
  for (let i = 0; i < 3000; i++) await run({ ...makeCtx(i), gate: ready });
  const samples = [];
  for (let rep = 0; rep < 5; rep++) {
    const releases = new Array(N);
    const ctxs = new Array(N);
    const pending = new Array(N);
    for (let i = 0; i < N; i++) {
      const ctx = makeCtx(i);
      ctx.gate = new Promise((r) => {
        releases[i] = r;
      });
      ctxs[i] = ctx;
    }
    const base = heap();
    for (let i = 0; i < N; i++) pending[i] = run(ctxs[i]);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const held = heap();
    samples.push((held - base) / N);
    for (const r of releases) r();
    await Promise.all(pending);
  }
  samples.sort((a, b) => a - b);
  return Math.round(samples[2]);
}

async function cpuCell({ model, mode, scenario }) {
  const mws = makeMws(SCENARIOS[scenario], () => null);
  const run = build(model, mws, () => OK, mode);
  const N = 100_000;
  for (let i = 0; i < 30_000; i++) await run(makeCtx(i));
  const samples = [];
  for (let rep = 0; rep < 5; rep++) {
    const t = process.hrtime.bigint();
    for (let i = 0; i < N; i++) await run(makeCtx(i));
    samples.push(Number(process.hrtime.bigint() - t) / N);
  }
  samples.sort((a, b) => a - b);
  return Math.round(samples[2]);
}

async function grid(kind) {
  const file = fileURLToPath(import.meta.url);
  const isBun = typeof Bun !== 'undefined';
  const rows = [];
  for (const scenario of Object.keys(SCENARIOS)) {
    const row = { scenario };
    for (const model of ['onion', 'hybrid']) {
      for (const mode of ['raw', 'safe', 'dev']) {
        const cell = Buffer.from(
          JSON.stringify({ kind, model, mode, scenario, N: 10_000 }),
        ).toString('base64url');
        const args = [
          ...(isBun || kind === 'cpu' ? [] : ['--expose-gc']),
          file,
          '--cell',
          cell,
        ];
        const out = spawnSync(process.execPath, args, { encoding: 'utf8' });
        if (out.status !== 0) throw new Error(out.stderr);
        row[`${model}/${mode}`] = Number(out.stdout.trim());
      }
    }
    rows.push(row);
    console.error(`${kind} ${scenario} done`);
  }
  console.log(
    JSON.stringify(
      {
        runtime: RUNTIME,
        kind,
        unit:
          kind === 'memory'
            ? 'bytes retained per pending request (median of 5, 10 000 pending)'
            : 'ns per request, dispatch only (median of 5 × 100 000)',
        rows,
      },
      null,
      2,
    ),
  );
}

const cellArg = process.argv.indexOf('--cell');
if (cellArg !== -1) {
  const cell = JSON.parse(
    Buffer.from(process.argv[cellArg + 1], 'base64url').toString(),
  );
  console.log(
    cell.kind === 'memory' ? await memoryCell(cell) : await cpuCell(cell),
  );
} else if (process.argv[2] === 'conformance') {
  await conformance();
} else if (process.argv[2] === 'memory' || process.argv[2] === 'cpu') {
  await grid(process.argv[2]);
} else {
  console.error('usage: contract-check.mjs conformance|memory|cpu');
  process.exit(1);
}
