// biome-ignore-all lint: experiment script kept as it was run; see ../README.md
// Does a LATER middleware see the AsyncLocalStorage store that an earlier middleware provided?
//  C2W : stage middleware + ctx.runInside(wrap) — the runner wraps only the handler (+ response hooks)
//  H   : around(ctx, next) — the rest of the chain, including later stage middleware, runs inside
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function c2w() {
  const seen = {};
  const ctx = { wrappers: [] };
  const mws = [
    async (ctx) => {
      await sleep(1);
      ctx.wrappers.push((next) => als.run({ user: 'alice' }, next));
    },
    async () => {
      seen.laterMiddleware = als.getStore()?.user ?? 'nothing';
    },
  ];
  const handler = async () => {
    seen.handler = als.getStore()?.user ?? 'nothing';
    return { status: 200 };
  };
  for (const mw of mws) await mw(ctx);
  let run = () => handler();
  for (let i = ctx.wrappers.length - 1; i >= 0; i--) {
    const inner = run;
    const w = ctx.wrappers[i];
    run = () => w(inner);
  }
  await run();
  return seen;
}
async function hybrid() {
  const seen = {};
  const mws = [
    {
      async around(ctx, next) {
        await sleep(1);
        return als.run({ user: 'alice' }, next);
      },
    },
    {
      async run() {
        seen.laterMiddleware = als.getStore()?.user ?? 'nothing';
      },
    },
  ];
  const handler = async () => {
    seen.handler = als.getStore()?.user ?? 'nothing';
    return { status: 200 };
  };
  function compile(i) {
    const stages = [];
    let j = i;
    while (j < mws.length && !mws[j].around) stages.push(mws[j++]);
    const wrapper = j < mws.length ? mws[j] : null;
    const inner = wrapper ? compile(j + 1) : null;
    return async (ctx) => {
      for (const s of stages) await s.run(ctx);
      return wrapper ? wrapper.around(ctx, () => inner(ctx)) : handler(ctx);
    };
  }
  await compile(0)({});
  return seen;
}
console.log('C2W ctx.runInside:', JSON.stringify(await c2w()));
console.log('H   around      :', JSON.stringify(await hybrid()));
