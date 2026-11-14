import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import Server from '../../server.ts';

const srcRoot = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../..',
);
const folder = (...p: string[]) => path.resolve(srcRoot, ...p);
const hangFlush = process.argv[2] === 'hang';

Sentry.init({
  dsn: 'https://public@example.com/1',
  transport: () => ({
    send: async () => {
      fs.writeSync(1, 'SENTRY_EVENT_SENT\n');
      return { statusCode: 200 };
    },
    flush: async () => {
      fs.writeSync(1, 'SENTRY_FLUSH_STARTED\n');
      if (hangFlush) {
        return new Promise<boolean>(() => {});
      }
      fs.writeSync(1, 'SENTRY_FLUSH_COMPLETED\n');
      return true;
    },
  }),
});

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
server.app.updateConfig('log', {
  transports: [
    {
      transport: 'sentry',
      transportOptions: { level: 'error' },
      enable: true,
    },
  ],
});
server.addErrorHandling();

const originalLog = console.log;
console.log = (...args: unknown[]) => {
  originalLog(...args);
  if (
    args.some((arg) =>
      String(arg).includes('Sentry Winston transport loaded successfully'),
    )
  ) {
    setImmediate(() => {
      throw new Error('Crash fixture exception');
    });
  }
};

void server.app.logger;
