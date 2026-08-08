import path from 'node:path';
import Server from '../../src/server.ts';

process.env.LOGGER_CONSOLE_LEVEL ||= 'error';

// `startServer` asserts both of these (`#assertBootConfig`): a missing Mongo DSN
// or AUTH_SALT is a hard boot failure. They are SATISFIED here, never used — the
// explicit `init({ isSkipModelInit: true })` below skips `initAllModels`, which is
// the only caller of `#mongooseConnect`, so mongoose is never dialed and no DB
// latency enters the measurement (see `.plans/refactor/done/baseline.md` for why
// this fixture deliberately excludes mongo). `||=` so a real environment wins.
//
// Keep these in step with `#assertBootConfig` — the assertion landing after this
// fixture was written is exactly what silently broke `npm run dev:bench:realistic`.
process.env.MONGO_DSN ||=
  'mongodb://127.0.0.1:27017/framework-bench-never-connected';
process.env.AUTH_SALT ||= 'benchmark-fixture-salt-not-a-secret';

const basePath = new URL('.', import.meta.url).pathname;
const srcRoot = path.resolve(basePath, '../../src');

const server = new Server({
  folders: {
    config: path.resolve(srcRoot, 'config'),
    controllers: path.resolve(basePath, 'controllers'),
    models: path.resolve(srcRoot, 'models'),
    emails: path.resolve(srcRoot, 'services/messaging/email/templates'),
    locales: path.resolve(srcRoot, 'locales'),
    commands: path.resolve(srcRoot, 'commands'),
    migrations: path.resolve(srcRoot, 'migrations'),
  },
});

await server.init({ isSkipModelInit: true });
await server.startServer();

console.log('\nRealistic benchmark fixture ready on port 3300');
console.log('Routes:');
console.log('  GET /bench/plaintext     no validation, no i18n');
console.log('  GET /bench/echo?name=X   query validation + i18n lookup');
