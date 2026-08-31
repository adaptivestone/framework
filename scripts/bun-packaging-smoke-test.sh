#!/usr/bin/env bash
#
# Bun packed-consumer smoke test (pairs with `packaging-smoke-test.sh`).
#
# The Node script proves the published tarball is *shaped* right. This one proves
# it RUNS on the second supported runtime: it packs the framework, installs the
# tarball with Bun's own installer, and — under Bun, through Bun's Node
# compatibility layer and the `ExpressAdapter` — imports the public surface,
# boots a `Server` against a real MongoDB, serves a request, runs Mongoose CRUD
# and shuts down.
#
# Skips cleanly (exit 0) when Bun is not installed, so machines without Bun are
# not failed by it. The MongoDB-backed half is skipped the same way when no
# server answers; set SMOKE_REQUIRE_MONGO=1 (CI does) to turn that skip into a
# failure.
#
# Env:
#   SMOKE_MONGO_URI      mongodb://127.0.0.1:27017 by default
#   SMOKE_REQUIRE_MONGO  1 = a missing/unreachable MongoDB fails the run
#
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "→ bun not installed — SKIPPING the Bun packaging smoke test"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Bun $(bun --version)"

echo "→ Building generated types + dist"
npm run gen --silent
npm run build --silent

echo "→ Packing"
TARBALL="$(npm pack --silent | tail -1)"
TARBALL_PATH="$ROOT/$TARBALL"
echo "  $TARBALL"

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH" "$TARBALL_PATH"' EXIT

echo "→ Installing into a scratch consumer with bun install"
cd "$SCRATCH"
printf '{\n  "name": "bun-smoke-consumer",\n  "private": true,\n  "version": "1.0.0",\n  "type": "module"\n}\n' > package.json
bun install --no-save "$TARBALL_PATH"

cat > check.bun.mjs <<'EOF'
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

assert.ok(
  typeof globalThis.Bun !== 'undefined',
  'this check must run under Bun',
);
console.log('  ✓ running under Bun', Bun.version);

// 1. The public entry points must import from the published dist. Bun resolves
//    the exports map with its own resolver, so this is not covered by the Node
//    script.
for (const spec of [
  '@adaptivestone/framework/server.js',
  '@adaptivestone/framework/Cli.js',
  '@adaptivestone/framework/cluster.js',
  '@adaptivestone/framework/folderConfig.js',
  '@adaptivestone/framework/types.js',
  '@adaptivestone/framework/modules/AbstractController.js',
  '@adaptivestone/framework/models/User.js',
  '@adaptivestone/framework/services/http/middleware/GetUserByToken.js',
  '@adaptivestone/framework/services/http/httpErrors.js',
  '@adaptivestone/framework/helpers/crypto.js',
  '@adaptivestone/framework/config/http.js',
]) {
  await import(spec);
  console.log('  ✓ import', spec);
}

// `cluster.js` imports cleanly, but running it stays a Node-only deployment
// entry until Bun's `node:cluster` is certified separately — do not boot it here.
const { runCluster } = await import('@adaptivestone/framework/cluster.js');
assert.equal(typeof runCluster, 'function');
console.log('  ✓ cluster import has no side effects and exports runCluster');

const { ensureTestServerReady } = await import(
  '@adaptivestone/framework/tests/testHelpers.js'
);
assert.equal(typeof ensureTestServerReady, 'function');
console.log('  ✓ test helpers export ensureTestServerReady');

// 2. Internal subpaths stay blocked under Bun's resolver too. Bun reports a
//    blocked subpath as ERR_MODULE_NOT_FOUND where Node uses
//    ERR_PACKAGE_PATH_NOT_EXPORTED — same outcome, different code.
for (const spec of [
  '@adaptivestone/framework/codegen/astEmit.js',
  '@adaptivestone/framework/commands/CreateUser.js',
]) {
  let blocked = false;
  try {
    import.meta.resolve(spec);
  } catch (e) {
    blocked =
      e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
      e.code === 'ERR_MODULE_NOT_FOUND';
  }
  assert.ok(blocked, `Expected ${spec} to NOT be exported`);
  console.log('  ✓ blocked', spec);
}

// 3. Optional peers must stay absent after `bun install` as well.
const require = createRequire(import.meta.url);
for (const spec of ['@redis/client', 'oxc-parser', 'i18next', 'i18next-fs-backend']) {
  let absent = false;
  try {
    require.resolve(spec);
  } catch (e) {
    absent = e.code === 'MODULE_NOT_FOUND';
  }
  assert.ok(absent, `${spec} resolved in a default bun install — it must stay optional`);
  console.log('  ✓', spec, 'absent (stays an optional peer)');
}

// 4. Boot the published Server against a real MongoDB and drive it.
const mongoUri = (process.env.SMOKE_MONGO_URI || 'mongodb://127.0.0.1:27017').replace(/\/$/, '');
const requireMongo = process.env.SMOKE_REQUIRE_MONGO === '1';

const pkgRoot = path.dirname(
  require.resolve('@adaptivestone/framework/package.json'),
);
const f = (p) => path.join(pkgRoot, 'dist', p);

const mongoose = (await import('mongoose')).default;
try {
  await mongoose.connect(`${mongoUri}/bun-smoke-probe`, {
    serverSelectionTimeoutMS: 3000,
  });
  await mongoose.disconnect();
} catch (e) {
  if (requireMongo) {
    throw new Error(`SMOKE_REQUIRE_MONGO=1 but ${mongoUri} is unreachable: ${e.message}`);
  }
  console.log(`  ⚠ SKIPPED boot/CRUD/HTTP — no MongoDB at ${mongoUri}`);
  console.log('✓ Bun packaging smoke test passed (import surface only)');
  process.exit(0);
}

process.env.LOGGER_CONSOLE_LEVEL = 'error';
process.env.AUTH_SALT = crypto.randomBytes(16).toString('hex');

const { default: Server } = await import('@adaptivestone/framework/server.js');
const dbName = `BUN_SMOKE_${crypto.randomUUID()}`;
const server = new Server({
  folders: {
    config: f('config'),
    controllers: f('controllers'),
    models: f('models'),
    emails: f('services/messaging/email/templates'),
    locales: f('locales'),
    commands: f('commands'),
    migrations: f('migrations'),
  },
});
await server.init({ isSkipModelInit: true });
server.updateConfig('mongo', { connectionString: `${mongoUri}/${dbName}` });
server.updateConfig('http', { port: 0 });
server.updateConfig('mail', { transport: 'stub' });
server.updateConfig('auth', { scrypt: { ln: 12, r: 8, p: 1 } });
await server.initAllModels();
await server.startServer();
console.log('  ✓ booted a Server from the published dist against', mongoUri);

// 5. One request through the Express adapter.
const port = server.app.getConfig('http').port;
const home = await fetch(`http://127.0.0.1:${port}/`);
assert.equal(home.status, 200);
console.log('  ✓ GET / ->', home.status, await home.text());

// 6. Mongoose CRUD on the published User model.
const User = server.app.getModel('User');
const email = `bun-smoke-${Date.now()}@example.com`;

const created = await User.create({ email, password: 'Passw0rd!' });
assert.ok(created._id);
console.log('  ✓ create', String(created._id));

const found = await User.findOne({ email });
assert.equal(found?.email, email);
console.log('  ✓ read');

await User.updateOne({ _id: created._id }, { $set: { 'name.first': 'Bun' } });
assert.equal((await User.findById(created._id))?.name?.first, 'Bun');
console.log('  ✓ update');

// scrypt through node:crypto: hashed on save, verified on the static.
assert.ok(await User.getUserByEmailAndPassword(email, 'Passw0rd!'));
assert.equal(await User.getUserByEmailAndPassword(email, 'wrong'), false);
console.log('  ✓ password hash round-trip');

await User.deleteOne({ _id: created._id });
assert.equal(await User.findById(created._id), null);
console.log('  ✓ delete');

// 7. Shut down cleanly — a leaked handle would hang the process here.
await mongoose.connection.db?.dropDatabase();
server.app.httpServer?.shutdown();
server.app.events.emit('shutdown');
await mongoose.disconnect();
console.log('  ✓ clean shutdown');
EOF

echo "→ Verifying the installed package under Bun"
bun run check.bun.mjs

echo "✓ Bun packaging smoke test passed"
