// Standalone research harness; no framework runtime or external dependencies.
// Run: node <dir>/strict-comparison.mjs [--requests=10000] [--processes=5]
//      [--hooks=2] [--output=<relative-file>] [--conformance-only]
// Each sample runs in a fresh --expose-gc Node process. No HTTP/throughput claim.
// Both runners omit next misuse detection, cancellation and production hook/error
// policies. Raw errors unwind through wrappers; a shared outer boundary maps 500.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIDDLEWARE = 10;
const WRAPPER_POSITIONS = [0, 4];
const HOOK_POSITIONS = [2, 7];
const BRAND = Symbol('response');
const OK = Object.freeze({ [BRAND]: true, status: 200 });
const STOP = Object.freeze({ [BRAND]: true, status: 403 });
const ERROR = Object.freeze({ [BRAND]: true, status: 500 });
const isResponse = (value) => value?.[BRAND] === true;
const isPromise = (value) => typeof value?.then === 'function';
const immediate = () => new Promise((resolve) => setImmediate(resolve));

// Ordinary explicit-next onion: no auto-continue, forgotten-return recovery,
// result memoization or wrapper-only classification. Synchronous `return next()`
// passes the downstream promise through without allocating an async frame.
function compileStrict(entries, handler) {
  return (ctx) => {
    function dispatch(index) {
      try {
        if (index === entries.length) {
          return Promise.resolve(handler(ctx));
        }
        return Promise.resolve(
          entries[index].middleware(ctx, () => dispatch(index + 1)),
        );
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return dispatch(0);
  };
}

// H: compile flat request-only segments once; nest only declared `around`.
// A synchronous fast path is available to H too. An async segment resumes in
// one async loop rather than retaining a continuation for each request-only step.
function compileHybrid(entries, handler, start = 0) {
  const stages = [];
  let index = start;
  while (index < entries.length && !entries[index].around) {
    stages.push(entries[index++].run);
  }
  const wrapper = entries[index]?.around;
  const inner = wrapper ? compileHybrid(entries, handler, index + 1) : null;
  const tail = wrapper ? (ctx) => wrapper(ctx, () => inner(ctx)) : handler;

  async function resume(ctx, pending, nextIndex) {
    let result = await pending;
    if (isResponse(result)) {
      return result;
    }
    for (let i = nextIndex; i < stages.length; i++) {
      result = await stages[i](ctx);
      if (isResponse(result)) {
        return result;
      }
    }
    return tail(ctx);
  }

  return (ctx) => {
    for (let i = 0; i < stages.length; i++) {
      const result = stages[i](ctx);
      if (isPromise(result)) {
        return resume(ctx, result, i + 1);
      }
      if (isResponse(result)) {
        return result;
      }
    }
    return tail(ctx);
  };
}

class Context {
  constructor(id, phase, resolved = false) {
    this.id = id;
    this.phase = phase;
    this.gate = resolved
      ? { promise: Promise.resolve(), release() {} }
      : (() => {
          let release;
          const promise = new Promise((resolve) => {
            release = resolve;
          });
          return { promise, release };
        })();
    this.steps = 0;
    this.scopeReads = 0;
    this.hooks = undefined;
    this.hookCalls = 0;
    this.timingMs = 0;
    this.commits = 0;
    this.rollbacks = 0;
    this.finallyCalls = 0;
    this.handlerReached = false;
    this.dispatchDone = false;
    this.writerOutsideScope = false;
    this.error = undefined;
    this.failAt = -1;
    this.stopAt = -1;
  }

  beforeSend(callback) {
    this.hooks ??= [];
    this.hooks.push(callback);
  }
}

function makeRoute(model, config) {
  // Two independent middleware-owned ALS stores, not nested values in one store.
  const stores = WRAPPER_POSITIONS.map(() => new AsyncLocalStorage());

  function readScopes(ctx, position) {
    for (let layer = 0; layer < stores.length; layer++) {
      if (WRAPPER_POSITIONS[layer] >= position) {
        continue;
      }
      ctx.scopeReads += stores[layer].getStore()?.id === ctx.id ? 1 : -1000;
    }
  }

  function work(ctx, position) {
    ctx.steps |= 1 << position;
    readScopes(ctx, position);
    if (HOOK_POSITIONS.slice(0, config.hooks).includes(position)) {
      const start = performance.now();
      ctx.beforeSend((response) => {
        ctx.timingMs += performance.now() - start;
        ctx.hookCalls++;
        return response;
      });
    }
    if (ctx.failAt === position) {
      throw new Error('synthetic downstream failure');
    }
    if (ctx.stopAt === position) {
      return STOP;
    }
  }

  const entries = Array.from({ length: MIDDLEWARE }, (_, position) => {
    const layer = WRAPPER_POSITIONS.indexOf(position);
    if (layer !== -1) {
      const around = (ctx, next) => {
        work(ctx, position);
        const value = { id: ctx.id, layer };
        if (config.wrapping === 'als-return') {
          return stores[layer].run(value, next);
        }
        return stores[layer].run(value, async () => {
          try {
            const response = await next();
            ctx.commits++;
            return response;
          } catch (error) {
            ctx.rollbacks++;
            throw error;
          } finally {
            ctx.finallyCalls++;
          }
        });
      };
      return { around, middleware: around };
    }
    if (config.prework === 'async') {
      return {
        async run(ctx) {
          await Promise.resolve();
          return work(ctx, position);
        },
        async middleware(ctx, next) {
          await Promise.resolve();
          const result = work(ctx, position);
          return isResponse(result) ? result : next();
        },
      };
    }
    return {
      run: (ctx) => work(ctx, position),
      middleware(ctx, next) {
        const result = work(ctx, position);
        return isResponse(result) ? result : next();
      },
    };
  });

  async function handler(ctx) {
    ctx.handlerReached = true;
    if (model !== 'handler-only') {
      readScopes(ctx, MIDDLEWARE);
    }
    if (ctx.phase === 'handler-pending') {
      await ctx.gate.promise;
    }
    return OK;
  }

  const run =
    model === 'handler-only'
      ? handler
      : model === 'strict-onion'
        ? compileStrict(entries, handler)
        : compileHybrid(entries, handler);

  async function decide(ctx) {
    let response;
    try {
      response = await run(ctx);
    } catch (error) {
      ctx.error = error;
      response = ERROR;
    }
    const hooks = ctx.hooks;
    ctx.hooks = undefined; // release beforeSend closures before a long write
    if (hooks) {
      for (let i = hooks.length - 1; i >= 0; i--) {
        response = (await hooks[i](response)) ?? response;
      }
    }
    ctx.dispatchDone = true;
    return response;
  }

  return async (ctx) => {
    const response = await decide(ctx);
    if (ctx.phase === 'writer-pending') {
      // Synthetic drain wait after the descriptor and all wrappers have returned.
      // No stream, socket, chunk iteration, backpressure or native boundary exists.
      ctx.writerOutsideScope = stores.every(
        (store) => store.getStore() === undefined,
      );
      await ctx.gate.promise;
    }
    return response;
  };
}

const scenarios = [
  { prework: 'sync', wrapping: 'als-return' },
  { prework: 'async', wrapping: 'als-return' },
  { prework: 'sync', wrapping: 'als-finally' },
  { prework: 'async', wrapping: 'als-finally' },
];

async function conformance(hooks) {
  let cases = 0;
  for (const model of ['strict-onion', 'hybrid']) {
    for (const scenario of scenarios) {
      const run = makeRoute(model, { ...scenario, hooks });
      for (const phase of ['handler-pending', 'writer-pending']) {
        const contexts = Array.from(
          { length: 40 },
          (_, id) => new Context(id, phase),
        );
        const pending = contexts.map(run);
        await immediate();
        for (const ctx of contexts) {
          assert.equal(ctx.steps, (1 << MIDDLEWARE) - 1);
          assert.equal(
            ctx.scopeReads,
            16,
            'own ALS values reach every suffix step',
          );
          assert.equal(ctx.dispatchDone, phase === 'writer-pending');
          assert.equal(
            ctx.finallyCalls,
            phase === 'writer-pending' && scenario.wrapping === 'als-finally'
              ? 2
              : 0,
          );
          if (phase === 'writer-pending') {
            assert.equal(ctx.writerOutsideScope, true);
          }
          ctx.gate.release();
        }
        const results = await Promise.all(pending);
        assert.ok(results.every((result) => result === OK));
        for (const ctx of contexts) {
          assert.equal(ctx.hookCalls, hooks);
          assert.equal(ctx.hooks, undefined);
          assert.equal(
            ctx.finallyCalls,
            scenario.wrapping === 'als-finally' ? 2 : 0,
          );
        }
        cases++;
      }
      for (const failure of ['throw', 'early-response']) {
        const ctx = new Context(1, 'handler-pending', true);
        ctx[failure === 'throw' ? 'failAt' : 'stopAt'] = 6;
        assert.equal(await run(ctx), failure === 'throw' ? ERROR : STOP);
        assert.equal(ctx.handlerReached, false);
        assert.equal(ctx.steps, (1 << 7) - 1);
        assert.equal(ctx.hookCalls, Math.min(hooks, 1));
        if (scenario.wrapping === 'als-finally') {
          assert.equal(ctx.rollbacks, failure === 'throw' ? 2 : 0);
          assert.equal(ctx.commits, failure === 'throw' ? 0 : 2);
          assert.equal(ctx.finallyCalls, 2);
        }
        cases++;
      }
    }
  }
  return { cases, concurrentRequestsPerPendingCase: 40, passed: true };
}

function heap() {
  global.gc();
  global.gc();
  return process.memoryUsage().heapUsed;
}

async function sample(config) {
  assert.equal(typeof global.gc, 'function', 'worker requires --expose-gc');
  const run = makeRoute(config.model, config);
  for (let i = 0; i < 2000; i++) {
    await run(new Context(i, config.phase, true));
  }
  await immediate();
  const empty = heap();
  // Contexts, gates and the two holding arrays exist before dispatch is measured.
  const contexts = Array.from(
    { length: config.requests },
    (_, id) => new Context(id, config.phase),
  );
  const pending = new Array(config.requests);
  const setup = heap();
  for (let i = 0; i < contexts.length; i++) {
    pending[i] = run(contexts[i]);
  }
  await immediate();
  const held = heap();
  for (const ctx of contexts) {
    assert.equal(ctx.handlerReached, true);
    assert.equal(ctx.dispatchDone, config.phase === 'writer-pending');
    if (config.model !== 'handler-only') {
      assert.equal(ctx.scopeReads, 16);
    }
    if (config.phase === 'writer-pending') {
      assert.equal(ctx.writerOutsideScope, true);
    }
    ctx.gate.release();
  }
  const results = await Promise.all(pending);
  assert.ok(results.every((response) => response === OK));
  return {
    setupBytesPerRequest: (setup - empty) / config.requests,
    pendingBytesPerRequest: (held - setup) / config.requests,
  };
}

function numericOption(name, fallback, min, max) {
  const argument = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  const value = argument ? Number(argument.slice(name.length + 3)) : fallback;
  assert.ok(
    Number.isInteger(value) && value >= min && value <= max,
    `invalid ${name}`,
  );
  return value;
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0],
    max: sorted.at(-1),
    samples: values,
  };
}

async function main() {
  const worker = process.argv.indexOf('--worker');
  if (worker !== -1) {
    const config = JSON.parse(
      Buffer.from(process.argv[worker + 1], 'base64url').toString(),
    );
    console.log(JSON.stringify(await sample(config)));
    return;
  }
  const hooks = numericOption('hooks', 2, 0, 2);
  const validation = await conformance(hooks);
  if (process.argv.includes('--conformance-only')) {
    console.log(JSON.stringify(validation));
    return;
  }
  const requests = numericOption('requests', 10000, 100, 100000);
  const processes = numericOption('processes', 5, 3, 15);
  const phases = ['handler-pending', 'writer-pending'];
  const cells = phases.flatMap((phase) => [
    {
      model: 'handler-only',
      phase,
      prework: 'sync',
      wrapping: 'als-return',
      hooks: 0,
    },
    ...scenarios.flatMap((scenario) =>
      ['strict-onion', 'hybrid'].map((model) => ({
        model,
        phase,
        ...scenario,
        hooks,
      })),
    ),
  ]);
  const observations = cells.map(() => []);
  const started = performance.now();
  for (let rep = 0; rep < processes; rep++) {
    // Alternate model/sample order; no overlapping workers or other benchmark work.
    const order = cells.map((_, index) => index);
    if (rep % 2) {
      order.reverse();
    }
    for (const index of order) {
      const encoded = Buffer.from(
        JSON.stringify({ ...cells[index], requests }),
      ).toString('base64url');
      const child = spawnSync(
        process.execPath,
        ['--expose-gc', fileURLToPath(import.meta.url), '--worker', encoded],
        { encoding: 'utf8', timeout: 30000 },
      );
      assert.equal(child.status, 0, child.stderr || String(child.error));
      observations[index].push(JSON.parse(child.stdout));
    }
    process.stderr.write(
      `Completed independent-process round ${rep + 1}/${processes}\n`,
    );
  }
  const rows = cells.map((cell, index) => ({
    ...cell,
    setupBytesPerRequest: summarize(
      observations[index].map((value) => value.setupBytesPerRequest),
    ),
    pendingBytesPerRequest: summarize(
      observations[index].map((value) => value.pendingBytesPerRequest),
    ),
  }));
  for (const row of rows) {
    const baseline = rows.find(
      (value) => value.model === 'handler-only' && value.phase === row.phase,
    );
    row.extraVsHandlerOnlyMedianBytes =
      row.pendingBytesPerRequest.median -
      baseline.pendingBytesPerRequest.median;
  }
  const report = {
    schemaVersion: 1,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    configuration: {
      requests,
      independentProcessesPerCell: processes,
      middleware: MIDDLEWARE,
      wrapperPositions: WRAPPER_POSITIONS,
      hooks,
      warmupRequestsPerProcess: 2000,
    },
    methodology: [
      'Separate fresh --expose-gc Node process per cell and replicate; medians of process samples.',
      'Force GC twice at each boundary; heapUsed only. Setup overhead includes contexts, deferred gates and two holding arrays, allocated before dispatch.',
      'Pending heap includes shared handler/decision/writer harness; handler-only is measured separately for each phase. Subtracted medians are descriptive, not paired estimates.',
      'The handler-only baseline never enters middleware ALS stores or registers timing hooks; extra-versus-baseline includes those features, not just dispatch continuations. Inspect setup and pending heap separately.',
      'Sync stages do useful state/ALS reads then return next directly in strict onion; H runs the equivalent stages in compiled flat segments. Async stages first await an already-resolved promise.',
      'Two distinct middleware-owned ALS stores scope the entire suffix. als-return returns store.run(value, next); als-finally additionally awaits downstream and records commit/rollback/finally.',
      'Both models register identical optional beforeSend timing hooks, drained and released before the writer phase. Hooks run outside middleware-owned ALS after unwinding.',
      'handler-pending waits inside the handler. writer-pending returns a constant descriptor, unwinds wrappers/hooks, then waits in a synthetic writer.',
    ],
    limitations: [
      'Research implementations, not a production framework benchmark. Both omit next misuse guards, cancellation, hook failure policies and registry/transport behavior.',
      'No HTTP, sockets, streams, chunk iteration, backpressure, RSS, native FFI, real I/O or throughput measurement.',
      'Async prework is a microtask boundary, not a database request. Constant descriptors and small ALS values understate full application memory.',
      'The synthetic writer validates a lifecycle boundary; it does not measure actual stream delivery or preserve middleware ALS during consumption.',
      'Results depend on runtime/JIT/GC and implementation details; sample ranges are not statistical confidence intervals.',
    ],
    conformance: validation,
    elapsedSeconds: (performance.now() - started) / 1000,
    rows,
  };
  const output = process.argv
    .find((arg) => arg.startsWith('--output='))
    ?.slice('--output='.length);
  if (output) {
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
}

await main();
