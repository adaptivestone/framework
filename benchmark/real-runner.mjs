// Real-runner benchmark: boots `benchmark/fixtures/realistic.ts` (no MongoDB)
// from a checkout and measures throughput, latency percentiles, server CPU per
// request, memory peaks, settled memory after GC and memory per pending
// request. Zero dependencies: `node:http` with a keep-alive agent, closed loop.
//
//   taskset -c 2,3 node benchmark/real-runner.mjs \
//     --root <checkout> --runtime node|bun --bin <path> --label <name> \
//     [--runs 3] [--warmup 3] [--duration 10] [--concurrency 64] [--pending 2000] \
//     [--server-cpu 1] [--out results.json]
//
// The server is pinned with `taskset -c <server-cpu>` when available; run this
// script itself pinned to other cores. Results go to stdout (and `--out`).

import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg, i, all) =>
      arg.startsWith('--') ? [arg.slice(2), all[i + 1]] : null,
    )
    .filter(Boolean),
);
const root = path.resolve(args.root ?? '.');
const runtime = args.runtime ?? 'node';
const bin = args.bin ?? runtime;
const label = args.label ?? path.basename(root);
const runs = Number(args.runs ?? 3);
const warmupS = Number(args.warmup ?? 3);
const durationS = Number(args.duration ?? 10);
const concurrency = Number(args.concurrency ?? 64);
const pending = Number(args.pending ?? 2000);
const serverCpu = args['server-cpu'] ?? '1';
const port = Number(args.port ?? 3390);
const origin = `http://127.0.0.1:${port}`;

const ROUTES = [
  { name: 'plaintext', method: 'GET', path: '/bench/plaintext' },
  { name: 'chain', method: 'GET', path: '/bench/chain' },
  { name: 'default401', method: 'GET', path: '/benchdefault' },
  {
    name: 'echoPost',
    method: 'POST',
    path: '/bench/echo',
    body: '{"name":"Alice"}',
  },
  { name: 'notFound', method: 'GET', path: '/nope' },
];

const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency + 8 });

function request({ method, path: p, body }, useAgent = agent) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${origin}${p}`,
      {
        method,
        agent: useAgent,
        headers: body
          ? {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(body),
            }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const stats = async (gc = false) =>
  JSON.parse(
    (await request({ method: 'GET', path: `/bench/stats${gc ? '?gc=1' : ''}` }))
      .body,
  );

const cpuMicros = (s) => s.cpu.user + s.cpu.system;

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
}

/** Closed loop: `concurrency` workers, each sending the next request when one ends. */
async function load(route, seconds, record) {
  const latencies = [];
  const statuses = new Map();
  const end = performance.now() + seconds * 1000;
  const worker = async () => {
    while (performance.now() < end) {
      const start = process.hrtime.bigint();
      const { status } = await request(route);
      if (record) {
        latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
        statuses.set(status, (statuses.get(status) ?? 0) + 1);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { latencies, statuses };
}

async function measureRoute(route) {
  await load(route, warmupS, false);
  const before = await stats();
  let peakHeap = 0;
  let peakRss = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const s = await stats();
      peakHeap = Math.max(peakHeap, s.memory.heapUsed);
      peakRss = Math.max(peakRss, s.memory.rss);
      await sleep(250);
    }
  })();
  const t0 = performance.now();
  const { latencies, statuses } = await load(route, durationS, true);
  const elapsed = (performance.now() - t0) / 1000;
  sampling = false;
  await sampler;
  const after = await stats();
  const settled = await stats(true);
  latencies.sort((a, b) => a - b);
  return {
    requests: latencies.length,
    statuses: Object.fromEntries(statuses),
    rps: latencies.length / elapsed,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    cpuMicrosPerRequest:
      (cpuMicros(after) - cpuMicros(before)) / latencies.length,
    peakHeapMB: peakHeap / 2 ** 20,
    peakRssMB: peakRss / 2 ** 20,
    settledHeapMB: settled.memory.heapUsed / 2 ** 20,
    settledRssMB: settled.memory.rss / 2 ** 20,
  };
}

async function measurePending() {
  const idle = await stats(true);
  const holdAgent = new http.Agent({ keepAlive: false, maxSockets: pending });
  const inFlight = Array.from({ length: pending }, () =>
    request({ method: 'GET', path: '/bench/hold' }, holdAgent),
  );
  await sleep(500);
  const held = await stats(true);
  await Promise.all(inFlight);
  holdAgent.destroy();
  return {
    pending,
    bytesPerPendingRequest:
      (held.memory.heapUsed - idle.memory.heapUsed) / pending,
    rssBytesPerPendingRequest: (held.memory.rss - idle.memory.rss) / pending,
  };
}

function startServer() {
  const script = 'benchmark/fixtures/realistic.ts';
  const runtimeArgs = runtime === 'bun' ? [script] : ['--expose-gc', script];
  const hasTaskset = spawnSync('taskset', ['--version']).status === 0;
  const [cmd, cmdArgs] = hasTaskset
    ? ['taskset', ['-c', serverCpu, bin, ...runtimeArgs]]
    : [bin, runtimeArgs];
  const child = spawn(cmd, cmdArgs, {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HTTP_PORT: String(port),
      LOGGER_CONSOLE_LEVEL: 'error',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return child;
}

async function waitReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await stats();
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error('server did not become ready');
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const results = [];
for (let run = 0; run < runs; run += 1) {
  const server = startServer();
  try {
    await waitReady();
    const routes = {};
    for (const route of ROUTES) {
      routes[route.name] = await measureRoute(route);
    }
    const pendingResult = await measurePending();
    const final = await stats(true);
    results.push({
      routes,
      pending: pendingResult,
      finalSettledHeapMB: final.memory.heapUsed / 2 ** 20,
      finalSettledRssMB: final.memory.rss / 2 ** 20,
    });
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
}

const summary = {
  label,
  runtime,
  runs,
  warmupS,
  durationS,
  concurrency,
  routes: {},
};
for (const route of ROUTES) {
  const cells = results.map((r) => r.routes[route.name]);
  summary.routes[route.name] = Object.fromEntries(
    [
      'rps',
      'p50',
      'p95',
      'p99',
      'cpuMicrosPerRequest',
      'peakHeapMB',
      'peakRssMB',
      'settledHeapMB',
      'settledRssMB',
    ].map((key) => [key, median(cells.map((c) => c[key]))]),
  );
  summary.routes[route.name].statuses = cells[0].statuses;
}
summary.bytesPerPendingRequest = median(
  results.map((r) => r.pending.bytesPerPendingRequest),
);
summary.rssBytesPerPendingRequest = median(
  results.map((r) => r.pending.rssBytesPerPendingRequest),
);
summary.finalSettledHeapMB = median(results.map((r) => r.finalSettledHeapMB));
summary.finalSettledRssMB = median(results.map((r) => r.finalSettledRssMB));

const output = JSON.stringify(summary, null, 2);
console.log(output);
if (args.out) {
  writeFileSync(args.out, output);
}
agent.destroy();
