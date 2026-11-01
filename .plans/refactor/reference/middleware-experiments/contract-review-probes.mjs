// Focused review regressions against the exact kernels in contract-check.mjs.
// Run: node .plans/refactor/reference/middleware-experiments/contract-review-probes.mjs
// Exit 1 means a promised invariant failed. No production runner is exercised.
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('./contract-check.mjs', import.meta.url),
  'utf8',
);
const marker = '// ───────────────────────── middleware';
const boundary = source.indexOf(marker);
if (boundary < 0) {
  throw new Error('Cannot locate the kernel boundary in contract-check.mjs');
}
// The research module has a CLI entry point and no exports. Load its unchanged
// kernel prefix, adding exports without executing its conformance/benchmark CLI.
const moduleSource = `${source.slice(0, boundary)}\nexport { build, response };\n`;
const { build, response } = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
);

const tick = () => new Promise((resolve) => setImmediate(resolve));
function gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const wrap = (name, onion) => ({ name, onion, around: onion });
const results = [];

for (const mode of ['safe', 'dev']) {
  const cleanup = gate();
  let cleaned = false;
  let answered = false;
  const pending = build(
    'onion',
    [
      wrap('Drop', (_ctx, next) => {
        next();
        return response(202, {});
      }),
      wrap('Cleanup', async (_ctx, next) => {
        try {
          return await next();
        } finally {
          await cleanup.promise;
          cleaned = true;
        }
      }),
    ],
    () => response(200, {}),
    mode,
  )({}).then((value) => {
    answered = true;
    return value;
  });
  await tick();
  const answeredBeforeCleanup = answered;
  cleanup.release();
  await pending;
  await tick();
  results.push({
    mode,
    case: 'wait for started downstream cleanup before answering',
    passed: !answeredBeforeCleanup && cleaned,
    answeredBeforeCleanup,
  });

  try {
    const value = await build(
      'onion',
      [
        wrap('PromiseConsumer', (_ctx, next) => next().then((r) => r)),
        wrap('Deny', () => response(403, {})),
      ],
      () => response(200, {}),
      mode,
    )({});
    results.push({
      mode,
      case: 'next returns a Promise for a synchronous short-circuit',
      passed: value.status === 403,
      status: value.status,
    });
  } catch (error) {
    results.push({
      mode,
      case: 'next returns a Promise for a synchronous short-circuit',
      passed: false,
      error: error.message,
    });
  }

  let savedNext;
  let handlerRuns = 0;
  const outer = gate();
  const stopped = build(
    'onion',
    [
      wrap('Outer', async (_ctx, next) => {
        const value = await next();
        await outer.promise;
        return value;
      }),
      wrap('ShortCircuit', (_ctx, next) => {
        savedNext = next;
        return response(403, {});
      }),
    ],
    () => {
      handlerRuns++;
      return response(200, {});
    },
    mode,
  )({});
  await tick();
  let refused = false;
  try {
    await savedNext();
  } catch {
    refused = true;
  }
  outer.release();
  const value = await stopped;
  results.push({
    mode,
    case: 'a completed layer cannot start its discarded suffix',
    passed: refused && handlerRuns === 0 && value.status === 403,
    refused,
    handlerRuns,
    status: value.status,
  });
}

console.log(JSON.stringify({ runtime: process.version, results }, null, 2));
if (results.some((result) => !result.passed)) {
  process.exitCode = 1;
}
