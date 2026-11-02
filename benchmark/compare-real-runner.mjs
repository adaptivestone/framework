// Compares two `real-runner.mjs` results (base vs head, same runtime) against
// the P1m budget: CPU per request on the middleware routes, memory per pending
// request, p99, settled memory after GC, and plaintext throughput.
//
//   node benchmark/compare-real-runner.mjs base.json head.json

import { readFileSync } from 'node:fs';

const [basePath, headPath] = process.argv.slice(2);
const base = JSON.parse(readFileSync(basePath, 'utf8'));
const head = JSON.parse(readFileSync(headPath, 'utf8'));

const rows = [];
const check = (name, baseValue, headValue, limit, unit, pass) => {
  rows.push({
    check: name,
    base: Number(baseValue.toFixed(2)),
    head: Number(headValue.toFixed(2)),
    delta: Number((headValue - baseValue).toFixed(2)),
    limit,
    unit,
    result: pass ? 'pass' : 'FAIL',
  });
};

for (const route of ['chain', 'echoPost', 'default401']) {
  const b = base.routes[route].cpuMicrosPerRequest;
  const h = head.routes[route].cpuMicrosPerRequest;
  check(`cpu/request ${route}`, b, h, '+4', 'µs', h - b <= 4);
}
for (const route of Object.keys(base.routes)) {
  const b = base.routes[route].p99;
  const h = head.routes[route].p99;
  check(
    `p99 ${route}`,
    b,
    h,
    '+10% or +0.5',
    'ms',
    h - b <= Math.max(0.5, b * 0.1),
  );
}
check(
  'bytes/pending request',
  base.bytesPerPendingRequest,
  head.bytesPerPendingRequest,
  '+3072',
  'B',
  head.bytesPerPendingRequest - base.bytesPerPendingRequest <= 3072,
);
check(
  'settled heap after all phases',
  base.finalSettledHeapMB,
  head.finalSettledHeapMB,
  '±5%',
  'MB',
  Math.abs(head.finalSettledHeapMB - base.finalSettledHeapMB) <=
    base.finalSettledHeapMB * 0.05,
);
check(
  'settled RSS after all phases',
  base.finalSettledRssMB,
  head.finalSettledRssMB,
  '±5%',
  'MB',
  Math.abs(head.finalSettledRssMB - base.finalSettledRssMB) <=
    base.finalSettledRssMB * 0.05,
);
check(
  'plaintext rps',
  base.routes.plaintext.rps,
  head.routes.plaintext.rps,
  '-5%',
  'req/s',
  head.routes.plaintext.rps >= base.routes.plaintext.rps * 0.95,
);

console.log(`${base.label} → ${head.label}`);
console.table(rows);
