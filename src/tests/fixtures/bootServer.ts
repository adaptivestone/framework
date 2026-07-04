import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Server from '../../server.ts';

// Configurable boot harness for docs 25/26 (spawned in a child so each scenario
// is an isolated process). Env knobs:
//   BOOT_MONGO=1        → set a (dummy) Mongo connection string
//   BOOT_BROKEN_MODEL=1 → point models at a fixture with a throwing model
//   BOOT_DUP_COPY=1     → point models at a fixture simulating a duplicate-framework-copy model
// On success: prints `BOOT_OK` and exits 0. On boot failure: prints
// `BOOT_FAIL: <message>` to stderr and exits 1.
const here = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcRoot = path.resolve(here, '../..');
const f = (...p: string[]) => path.resolve(srcRoot, ...p);

const withMongo = process.env.BOOT_MONGO === '1';
const brokenModel = process.env.BOOT_BROKEN_MODEL === '1';
const dupCopyModel = process.env.BOOT_DUP_COPY === '1';

let modelsFolder = f('models');
if (brokenModel) {
  modelsFolder = path.resolve(here, 'bootModels');
} else if (dupCopyModel) {
  modelsFolder = path.resolve(here, 'bootModelsDupCopy');
}

const server = new Server({
  folders: {
    config: f('config'),
    controllers: f('controllers'),
    models: modelsFolder,
    emails: f('services/messaging/email/templates'),
    locales: f('locales'),
    commands: f('commands'),
    migrations: f('migrations'),
  },
});

await server.init({ isSkipModelInit: true });

// A dummy connection string is enough — the model-init loop registers schemas
// without a live connection, and the AUTH_SALT check is config-only. The
// fire-and-forget connect just fails in the background.
server.app.updateConfig('mongo', {
  connectionString: withMongo ? 'mongodb://127.0.0.1:27017/boot_fixture' : '',
});
server.app.updateConfig('auth', { scrypt: { ln: 12, r: 8, p: 1 } });
server.app.updateConfig('http', { port: 0 });

try {
  await server.initAllModels();
  await server.startServer();
} catch (e) {
  fs.writeSync(2, `BOOT_FAIL: ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
}

fs.writeSync(1, 'BOOT_OK\n');
process.exit(0);
