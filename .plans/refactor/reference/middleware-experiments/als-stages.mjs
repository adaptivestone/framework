// biome-ignore-all lint: experiment script kept as it was run; see README.md
// Stages (C2) runner: how can a middleware make data available through AsyncLocalStorage
// to the handler, deep services, onResponse and onFinish? 40 concurrent requests per scenario.
import { AsyncLocalStorage } from 'node:async_hooks';
import dc from 'node:diagnostics_channel';
import http from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => sleep(1 + Math.floor(Math.random() * 5));

// ── Framework side ──
const requestStore = new AsyncLocalStorage(); // A: one framework-owned store, holds ctx
export const requestContext = () => requestStore.getStore();
const handlerChannel = dc.tracingChannel('adaptivestone:handler'); // C

async function runStages(ctx, middlewares, handler, { frameworkStore }) {
  const dispatch = async () => {
    for (const mw of middlewares) await mw(ctx);
    let run = () => handlerChannel.tracePromise(() => handler(ctx), { ctx });
    for (let i = ctx.wrappers.length - 1; i >= 0; i -= 1) {
      const inner = run;
      const wrap = ctx.wrappers[i];
      run = () => wrap(inner); // B: middleware-provided wrappers around the handler
    }
    let response = await run();
    for (let i = ctx.onResponse.length - 1; i >= 0; i -= 1)
      response = ctx.onResponse[i](response) ?? response;
    ctx.res.once('finish', () => ctx.onFinish.forEach((fn) => fn()));
    ctx.res.end(JSON.stringify(response));
  };
  return frameworkStore ? requestStore.run(ctx, dispatch) : dispatch();
}

// ── App side ──
const userStore = new AsyncLocalStorage();
const tenantStore = new AsyncLocalStorage();
const findUser = async (ctx) => {
  await jitter();
  return `user-${ctx.id}`;
};
const seen = (label, v, ctx) =>
  v === `user-${ctx.id}` ? 'ok' : `${label}=${v ?? 'nothing'}`;

// Deep service code that never receives ctx.
async function service(read) {
  await jitter();
  return read();
}

const scenarios = {
  // A — framework store: middleware writes into ctx, anyone reads requestContext().
  'A framework store': {
    frameworkStore: true,
    mw: async (ctx) => {
      ctx.state.user = await findUser(ctx);
    },
    read: () => requestContext()?.state.user,
  },
  // B — middleware's own store, runner wraps the handler with it.
  'B ctx.runInside(wrap)': {
    mw: async (ctx) => {
      const user = await findUser(ctx);
      ctx.runInside((next) => userStore.run(user, next));
    },
    read: () => userStore.getStore(),
  },
  // C — a library binds its own store to the framework's handler channel (set up once at boot).
  'C diagnostics_channel': {
    mw: async (ctx) => {
      ctx.state.tenantUser = await findUser(ctx);
    },
    read: () => tenantStore.getStore(),
  },
  // D — enterWith inside the middleware.
  'D enterWith before await': {
    mw: async (ctx) => {
      const p = findUser(ctx);
      userStore.enterWith(`user-${ctx.id}`);
      await p;
    },
    read: () => userStore.getStore(),
  },
  'D enterWith after await': {
    mw: async (ctx) => {
      userStore.enterWith(await findUser(ctx));
    },
    read: () => userStore.getStore(),
  },
  // E — run() inside a stages middleware: nothing to wrap, the scope ends with the callback.
  'E als.run in middleware': {
    mw: async (ctx) => {
      const user = await findUser(ctx);
      userStore.run(user, () => {});
    },
    read: () => userStore.getStore(),
  },
};
let bindC = false;
handlerChannel.start.bindStore(tenantStore, (msg) =>
  bindC ? msg.ctx.state.tenantUser : undefined,
);

const results = {};
let current;
const server = http.createServer(async (req, res) => {
  const s = scenarios[current];
  const ctx = {
    id: new URL(req.url, 'http://x').searchParams.get('id'),
    res,
    state: {},
    wrappers: [],
    onResponse: [],
    onFinish: [],
  };
  ctx.runInside = (wrap) => ctx.wrappers.push(wrap);
  const r = (results[current] ??= {
    handler: 0,
    service: 0,
    onResponse: 0,
    onFinish: 0,
    fail: new Set(),
  });
  const check = (where, v) => {
    const o = seen(where, v, ctx);
    if (o === 'ok') r[where] += 1;
    else r.fail.add(o);
  };
  await runStages(
    ctx,
    [s.mw],
    async () => {
      check('handler', s.read());
      check('service', await service(s.read));
      ctx.onResponse.push((resp) => {
        check('onResponse', s.read());
        return resp;
      });
      ctx.onFinish.push(() => check('onFinish', s.read()));
      return { ok: true };
    },
    { frameworkStore: s.frameworkStore },
  );
});

server.listen(0, async () => {
  const { port } = server.address();
  const N = 40;
  const runtime =
    typeof Bun === 'undefined'
      ? `node ${process.version}`
      : `bun ${Bun.version}`;
  console.log(
    `stages runner, ${N} concurrent requests per scenario (${runtime}); count = saw its OWN user`,
  );
  for (const name of Object.keys(scenarios)) {
    current = name;
    bindC = name.startsWith('C');
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        fetch(`http://127.0.0.1:${port}/?id=${i}`).then((x) => x.text()),
      ),
    );
    await sleep(50);
    const r = results[name];
    const fails = [...r.fail].slice(0, 2).join(', ');
    console.log(
      `  ${name.padEnd(26)} handler ${r.handler}/${N} service ${r.service}/${N} onResponse ${r.onResponse}/${N} onFinish ${r.onFinish}/${N}${fails ? `  e.g. ${fails}` : ''}`,
    );
  }
  server.close();
});
