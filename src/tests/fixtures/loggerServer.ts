import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Server from '../../server.ts';

// Boots a Server (in a child process, to dodge the one-Server-per-process
// singleton) with a single custom log transport, then accesses the logger to
// trigger #createLogger's dynamic transport import. argv[2] is the transport
// module specifier (or a nonexistent path, to exercise the import-failure path).
const transportSpec = process.argv[2] ?? '';
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

await server.init({ isSkipModelInit: true });
// Replace the transport list with just our fixture transport, enabled.
server.app.updateConfig('log', {
  transports: [
    {
      transport: transportSpec,
      transportOptions: { level: 'silly' },
      enable: true,
    },
  ],
});

// Accessing the logger triggers #createLogger's fire-and-forget transport
// import. The test polls our output for the transport's marker (or the
// import-failure log) and kills us as soon as it appears — no timing window to
// race. This bounded keep-alive just stops the process lingering if the test
// goes away.
void server.app.logger;
setTimeout(() => process.exit(0), 10_000);
