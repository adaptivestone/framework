#!/usr/bin/env bash
#
# Packaging smoke test (doc 28.22 / pairs with doc 24).
#
# Builds the dist, packs the tarball, installs it into a throwaway consumer, and
# verifies the PUBLISHED package — not the TS source the test suite runs against:
#   - public entry points actually import (exercises the dist's rewritten relative
#     import paths — the class of bug behind the cluster fork-bomb, doc 03);
#   - internal subpaths are NOT exported (the doc-24 exports map);
#   - a Server constructs from the published dist.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Building generated types + dist"
npm run gen --silent
npm run build --silent

echo "→ Packing"
TARBALL="$(npm pack --silent | tail -1)"
TARBALL_PATH="$ROOT/$TARBALL"
echo "  $TARBALL"

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH" "$TARBALL_PATH"' EXIT

echo "→ Installing into a scratch consumer"
cd "$SCRATCH"
npm init -y >/dev/null 2>&1
npm install --silent --no-audit --no-fund "$TARBALL_PATH"

cat > check.mjs <<'EOF'
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// 1. Actually import the heavy entry points → exercises the dist import graph,
//    catching broken relative import paths in the build.
for (const spec of [
  '@adaptivestone/framework/server.js',
  '@adaptivestone/framework/Cli.js',
  '@adaptivestone/framework/folderConfig.js',
  '@adaptivestone/framework/types.js',
  '@adaptivestone/framework/modules/AbstractController.js',
  '@adaptivestone/framework/models/User.js',
  '@adaptivestone/framework/services/http/middleware/GetUserByToken.js',
  '@adaptivestone/framework/helpers/crypto.js',
]) {
  await import(spec);
  console.log('  ✓ import', spec);
}

// 2. Public subpath that pulls a dev dep (vitest): resolve only, don't execute.
import.meta.resolve('@adaptivestone/framework/tests/setupVitest.js');
console.log('  ✓ resolve @adaptivestone/framework/tests/setupVitest.js');

// 2b. Config files are the extension surface: consumers import a framework
//     default config and re-export an edited copy (see the example project's
//     src/config/*). They MUST stay importable.
await import('@adaptivestone/framework/config/http.js');
console.log('  ✓ import @adaptivestone/framework/config/http.js');

// 3. Internal subpaths must be blocked by the exports map.
for (const spec of [
  '@adaptivestone/framework/codegen/astEmit.js',
  '@adaptivestone/framework/commands/CreateUser.js',
]) {
  let blocked = false;
  try {
    import.meta.resolve(spec);
  } catch (e) {
    blocked = e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED';
  }
  if (!blocked) {
    throw new Error(`Expected ${spec} to NOT be exported`);
  }
  console.log('  ✓ blocked', spec);
}

// 4. Construct a Server from the published dist (no DB boot).
const { default: Server } = await import('@adaptivestone/framework/server.js');
const require = createRequire(import.meta.url);
const pkgRoot = path.dirname(
  require.resolve('@adaptivestone/framework/package.json'),
);
const f = (p) => path.join(pkgRoot, 'dist', p);
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
if (typeof server?.app?.getConfig !== 'function') {
  throw new Error('Server constructed but app.getConfig is missing');
}
console.log('  ✓ constructed a Server from the published dist');

// 5. Runtime assets must ship. tsc compiles .ts only — locale JSON and email
//    .pug templates are copied in postbuild. If they are missing, a consumer on
//    the default config gets raw i18n keys and the email module can't render.
for (const asset of [
  'locales/en/translation.json',
  'services/messaging/email/templates/verification/html.pug',
]) {
  if (!existsSync(f(asset))) {
    throw new Error(`Expected published asset to exist: dist/${asset}`);
  }
  console.log('  ✓ asset', asset);
}
EOF

echo "→ Verifying the installed package"
node check.mjs

echo "✓ Packaging smoke test passed"
