import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Server from '../../server.ts';

// Config-loading harness for finding #11 (spawned in a child so NODE_ENV can be
// controlled per scenario without disturbing the in-process test server). The
// config folder is a fixture whose `configLoad/` holds an env-only config
// (`envOnly.production.ts`, no base `envOnly.ts`) plus a base+env pair
// (`withBase.ts` + `withBase.production.ts`). Only config loading runs — model
// loading/init and HTTP boot are skipped, so no Mongo/AUTH_SALT is needed.
//
// On success: prints `CONFIGS_JSON=<json>` and exits 0. On init failure: prints
// `INIT_FAIL: <message>` to stderr and exits 1.
const here = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcRoot = path.resolve(here, '../..');
const f = (...p: string[]) => path.resolve(srcRoot, ...p);

const server = new Server({
  folders: {
    config: path.resolve(here, 'configLoad'),
    controllers: f('controllers'),
    models: f('models'),
    emails: f('services/messaging/email/templates'),
    locales: f('locales'),
    commands: f('commands'),
    migrations: f('migrations'),
  },
});

try {
  await server.init({ isSkipModelInit: true, isSkipModelLoading: true });
} catch (e) {
  fs.writeSync(2, `INIT_FAIL: ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
}

const result = {
  envOnly: server.app.getConfig('envOnly'),
  withBase: server.app.getConfig('withBase'),
};
fs.writeSync(1, `CONFIGS_JSON=${JSON.stringify(result)}\n`);
process.exit(0);
