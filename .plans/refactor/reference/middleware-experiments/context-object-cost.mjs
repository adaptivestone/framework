// biome-ignore-all lint: experiment script kept as it was run; see README.md
// Cost of a separate framework `ctx` object per request (D2 option C, 2026-11-01).
// usage: node --expose-gc context-object-cost.mjs   |   bun context-object-cost.mjs
class RequestContext {
  #req;
  #res;
  #url;
  #signal;
  #id;
  #finish;
  appInfo;
  constructor(req, res) {
    this.#req = req;
    this.#res = res;
    this.appInfo = req.appInfo; // the same object v1 middleware use
  }
  get method() {
    return this.#req.method;
  }
  get headers() {
    return this.#req.headers;
  }
  get path() {
    return this.#req.decodedPath;
  }
  get route() {
    return this.#req.routeTemplate;
  }
  get url() {
    return (this.#url ??= new URL(
      this.#req.url,
      `http://${this.#req.headers.host}`,
    ));
  }
  get id() {
    return (this.#id ??=
      this.#req.headers['x-request-id'] ?? crypto.randomUUID());
  }
  get signal() {
    if (!this.#signal) {
      const controller = new AbortController();
      this.#signal = controller.signal;
    }
    return this.#signal;
  }
  onFinish(cb) {
    (this.#finish ??= []).push(cb);
  }
}

const gc =
  globalThis.gc ?? (typeof Bun !== 'undefined' ? () => Bun.gc(true) : null);
const heap = () => {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
};
const N = 100_000;
const reqs = Array.from({ length: N }, (_, i) => ({
  method: 'GET',
  url: `/users/${i}?page=2`,
  decodedPath: `/users/${i}`,
  routeTemplate: '/users/:id',
  headers: { host: 'example.test' },
  appInfo: {},
}));
const res = {};

function measure(label, touch) {
  const samples = [];
  for (let rep = 0; rep < 5; rep++) {
    const held = new Array(N);
    const base = heap();
    for (let i = 0; i < N; i++) {
      const ctx = new RequestContext(reqs[i], res);
      touch(ctx);
      held[i] = ctx;
    }
    samples.push((heap() - base) / N);
    held.length = 0;
  }
  samples.sort((a, b) => a - b);
  return `${label.padEnd(44)} ${Math.round(samples[2])} B`;
}

const runtime =
  typeof Bun === 'undefined' ? `node ${process.version}` : `bun ${Bun.version}`;
console.log(runtime);
console.log(measure('ctx only (lazy fields untouched)', () => {}));
console.log(
  measure('ctx + onFinish callback registered', (c) => c.onFinish(() => {})),
);
console.log(measure('ctx + ctx.url read (URL object)', (c) => c.url));
console.log(
  measure('ctx + ctx.signal read (AbortController)', (c) => c.signal),
);
console.log(
  measure(
    'ctx + url + signal + id + onFinish',
    (c) => (c.url, c.signal, c.id, c.onFinish(() => {})),
  ),
);
