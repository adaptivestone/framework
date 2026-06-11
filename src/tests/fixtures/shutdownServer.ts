import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Server from '../../server.ts';

// Minimal standalone server used by shutdown.test.ts. Booted in a child process
// so a real SIGTERM / a real port conflict can be observed (exit codes, marker
// output) — neither is testable in-process. No database: doc 12 is about the
// process lifecycle, and HTTP boots without mongo.
const port = Number(process.argv[2] ?? 0);
const srcRoot = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../..',
);
const folder = (...p: string[]) => path.resolve(srcRoot, ...p);

const server = new Server({
  folders: {
    config: folder('config'),
    controllers: folder('controllers'),
    models: folder('models'),
    emails: folder('services/messaging/email/templates'),
    locales: folder('locales'),
    commands: folder('commands'),
    migrations: folder('migrations'),
  },
});

// Proof the 'shutdown' event fired. Written synchronously to fd 1 so the marker
// is flushed deterministically, independent of exit timing.
server.app.events.on('shutdown', () => {
  fs.writeSync(1, 'SHUTDOWN_EVENT_FIRED\n');
});

await server.init({ isSkipModelInit: true });
server.app.updateConfig('http', { port });
await server.startServer();
fs.writeSync(1, 'SERVER_LISTENING\n');
