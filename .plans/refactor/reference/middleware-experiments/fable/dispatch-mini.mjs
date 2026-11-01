// biome-ignore-all lint: experiment script kept as it was run; see ../README.md
// CPU per request (no HTTP) for the runners that cover every requirement: BL (onion, flat loop),
// H (hybrid by declaration, composed once), C2 (stages + hooks) and linear for reference.
// 10 middleware, 2 of them wrap (timing). median ns/request.
const RUNS = 5,
  ITER = 60_000,
  MW = 10,
  AROUND = 2;
const RESPONSE = { status: 200 };
const isResponse = (v) =>
  v !== undefined && v !== null && v.status !== undefined;
const handler = async () => RESPONSE;

function mwList(kind) {
  const out = [];
  for (let i = 0; i < MW; i++) {
    const wraps = i < AROUND;
    if (kind === 'onion')
      out.push(
        wraps
          ? async (ctx, next) => {
              const t0 = performance.now();
              const r = await next();
              ctx.t = performance.now() - t0;
              return r;
            }
          : async (ctx) => {
              ctx[i] = 1;
            },
      );
    if (kind === 'H')
      out.push(
        wraps
          ? {
              async around(ctx, next) {
                const t0 = performance.now();
                const r = await next();
                ctx.t = performance.now() - t0;
                return r;
              },
            }
          : {
              async run(ctx) {
                ctx[i] = 1;
              },
            },
      );
    if (kind === 'C2')
      out.push(
        wraps
          ? async (ctx) => {
              const t0 = performance.now();
              (ctx.hooks ??= []).push(() => {
                ctx.t = performance.now() - t0;
              });
            }
          : async (ctx) => {
              ctx[i] = 1;
            },
      );
    if (kind === 'linear')
      out.push(async (ctx) => {
        ctx[i] = 1;
      });
  }
  return out;
}
const onion = mwList('onion');
async function BL(ctx, start = 0) {
  for (let i = start; i < onion.length; i++) {
    let downstream;
    const next = () => {
      if (downstream) throw new Error('twice');
      downstream = BL(ctx, i + 1);
      return downstream;
    };
    const r = await onion[i](ctx, next);
    if (isResponse(r)) return r;
    if (downstream) return downstream;
  }
  return handler(ctx);
}
const hs = mwList('H');
function compileH(i) {
  const stages = [];
  let j = i;
  while (j < hs.length && !hs[j].around) stages.push(hs[j++]);
  const wrapper = j < hs.length ? hs[j] : null;
  const inner = wrapper ? compileH(j + 1) : null;
  return async (ctx) => {
    for (let k = 0; k < stages.length; k++) {
      const r = await stages[k].run(ctx);
      if (isResponse(r)) return r;
    }
    return wrapper ? wrapper.around(ctx, () => inner(ctx)) : handler(ctx);
  };
}
const H = compileH(0);
const c2 = mwList('C2');
async function C2(ctx) {
  for (let i = 0; i < c2.length; i++) {
    const r = await c2[i](ctx);
    if (isResponse(r)) return r;
  }
  const res = await handler(ctx);
  if (ctx.hooks)
    for (let i = ctx.hooks.length - 1; i >= 0; i--) ctx.hooks[i](res);
  return res;
}
const lin = mwList('linear');
async function linear(ctx) {
  for (let i = 0; i < lin.length; i++) {
    const r = await lin[i](ctx);
    if (isResponse(r)) return r;
  }
  return handler(ctx);
}
async function measure(fn) {
  for (let i = 0; i < 20_000; i++) await fn({});
  const s = [];
  for (let r = 0; r < RUNS; r++) {
    const t = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) await fn({});
    s.push(Number(process.hrtime.bigint() - t) / ITER);
  }
  s.sort((a, b) => a - b);
  return s[2];
}
const rt =
  typeof Bun === 'undefined' ? `node ${process.version}` : `bun ${Bun.version}`;
console.log(
  `${rt}: ${MW} middleware, ${AROUND} wrap (timing), median ns/request`,
);
for (const [name, fn] of [
  ['linear (no wrap at all)', linear],
  ['C2 stages + hooks', C2],
  ['BL onion flat-loop', BL],
  ['H hybrid composed', H],
])
  console.log(
    `  ${name.padEnd(26)} ${(await measure(fn)).toFixed(0).padStart(5)} ns`,
  );
