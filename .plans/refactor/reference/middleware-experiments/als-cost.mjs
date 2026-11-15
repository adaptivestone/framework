// biome-ignore-all lint: experiment script kept as it was run; see README.md
// Cost of one framework-owned AsyncLocalStorage.run per request: time and retained memory.
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();
const gc =
  globalThis.gc ?? (typeof Bun !== 'undefined' ? () => Bun.gc(true) : null);
const runtime =
  typeof Bun === 'undefined' ? `node ${process.version}` : `bun ${Bun.version}`;

// Typical request: a few awaits in middleware and handler.
async function request(ctx) {
  await null;
  ctx.state.user = 'u';
  await null;
  return store.getStore()?.state.user ?? ctx.state.user;
}

async function time(label, fn) {
  const N = 1_000_000;
  for (let i = 0; i < 200_000; i += 1) await fn();
  const t = process.hrtime.bigint();
  for (let i = 0; i < N; i += 1) await fn();
  return Number(process.hrtime.bigint() - t) / N;
}

async function retained(withStore) {
  const N = 20_000;
  const holders = [];
  const pending = (ctx) =>
    new Promise((resolve) => holders.push(resolve)).then(
      () => store.getStore() ?? ctx,
    );
  gc();
  gc();
  const before = process.memoryUsage().heapUsed;
  const all = [];
  for (let i = 0; i < N; i += 1) {
    const ctx = { state: {} };
    all.push(withStore ? store.run(ctx, () => pending(ctx)) : pending(ctx));
  }
  gc();
  gc();
  const bytes = (process.memoryUsage().heapUsed - before) / N;
  holders.forEach((r) => r());
  await Promise.all(all);
  return bytes;
}

const plain = await time('plain', () => request({ state: {} }));
const withRun = await time('run', () => {
  const ctx = { state: {} };
  return store.run(ctx, () => request(ctx));
});
console.log(
  `${runtime}: per request  plain ${plain.toFixed(0)} ns · with store.run ${withRun.toFixed(0)} ns (+${(withRun - plain).toFixed(0)} ns)`,
);
if (gc) {
  const a = [];
  const b = [];
  for (let i = 0; i < 5; i += 1) {
    a.push(await retained(false));
    b.push(await retained(true));
  }
  const med = (x) => x.sort((p, q) => p - q)[2];
  console.log(
    `${runtime}: retained per pending request  plain ${med(a).toFixed(0)} B · with store ${med(b).toFixed(0)} B (+${(med(b) - med(a)).toFixed(0)} B)`,
  );
}
