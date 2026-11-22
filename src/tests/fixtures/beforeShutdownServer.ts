import fs from 'node:fs';
import type { Socket } from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import Server from '../../server.ts';

// Standalone server for the `'beforeShutdown'` tests in shutdown.test.ts. Its
// `GET /hold` answers like an SSE stream and never ends on its own, so the HTTP
// drain can only finish once a `'beforeShutdown'` listener closes the socket.
// The optional mode adds a listener that never settles (`hang`), that fails
// (`throw`), that takes long (`slow`), or `once` and `function` listeners
// (`semantics`). No live database, as in shutdownServer.ts.
const port = Number(process.argv[2] ?? 0);
const mode = process.argv[3];
const srcRoot = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../..',
);
const folder = (...p: string[]) => path.resolve(srcRoot, ...p);
const held = new Set<Socket>();

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
  bootHttp: (app) => {
    app.httpServer?.routeRegistry.registerRoute('GET', '/hold', {
      handler: (req: Request, res: Response) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: open\n\n');
        held.add(req.socket);
        fs.writeSync(1, 'REQUEST_HELD\n');
      },
    });
  },
});

const isListening = () => server.app.httpServer?.httpServer.listening;

server.app.events.on('beforeShutdown', async () => {
  fs.writeSync(1, `BEFORE_SHUTDOWN_STARTED:listening=${isListening()}\n`);
  await sleep(200);
  for (const socket of held) {
    socket.destroy();
  }
  fs.writeSync(1, `BEFORE_SHUTDOWN_DONE:listening=${isListening()}\n`);
});
if (mode === 'hang') {
  server.app.events.on('beforeShutdown', () => new Promise(() => {}));
}
if (mode === 'throw') {
  server.app.events.on('beforeShutdown', () => {
    throw new Error('BEFORE_SHUTDOWN_SYNC_FAILURE');
  });
  server.app.events.on('beforeShutdown', async () => {
    throw new Error('BEFORE_SHUTDOWN_ASYNC_FAILURE');
  });
}
if (mode === 'slow') {
  server.app.events.on('beforeShutdown', async () => {
    fs.writeSync(1, 'SLOW_LISTENER_STARTED\n');
    await sleep(1_500);
    fs.writeSync(1, 'SLOW_LISTENER_DONE\n');
  });
}
if (mode === 'semantics') {
  const { events } = server.app;
  const onceListener = async () => {
    await sleep(500);
    fs.writeSync(1, 'ONCE_LISTENER_DONE\n');
  };
  events.once('beforeShutdown', onceListener);
  events.on('beforeShutdown', function (this: unknown) {
    fs.writeSync(1, `THIS_IS_EMITTER:${this === events}\n`);
  });
  events.on('shutdown', () => {
    const removed = !events.listeners('beforeShutdown').includes(onceListener);
    fs.writeSync(1, `ONCE_LISTENER_REMOVED:${removed}\n`);
  });
}
server.app.events.on('shutdown', () => {
  fs.writeSync(1, 'SHUTDOWN_EVENT_FIRED\n');
});

await server.init({ isSkipModelInit: true });
server.app.updateConfig('http', { port });
await server.startServer();
fs.writeSync(1, 'SERVER_LISTENING\n');
