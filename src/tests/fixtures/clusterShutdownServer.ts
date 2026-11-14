import cluster from 'node:cluster';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import { runCluster } from '../../clusterRunner.ts';
import Server from '../../server.ts';

const port = Number(process.argv[2] ?? 0);
const srcRoot = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../..',
);
const folder = (...p: string[]) => path.resolve(srcRoot, ...p);

await runCluster(
  async () => {
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
        if (!app.httpServer) {
          throw new Error('bootHttp ran without a live httpServer');
        }
        app.httpServer.routeRegistry.registerRoute('GET', '/hold', {
          handler: (_req: Request, res: Response) => {
            fs.writeSync(1, `REQUEST_STARTED:${process.pid}\n`);
            setTimeout(() => {
              res.end('DRAINED');
              fs.writeSync(1, `REQUEST_DRAINED:${process.pid}\n`);
            }, 400);
          },
        });
      },
    });

    server.app.events.on('shutdown', () => {
      fs.writeSync(1, `SHUTDOWN_EVENT_FIRED:${process.pid}\n`);
    });
    await server.init({ isSkipModelInit: true });
    server.app.updateConfig('http', { port });
    await server.startServer();
    fs.writeSync(1, `SERVER_LISTENING:${port}:${process.pid}\n`);
  },
  {
    workers: 1,
    shutdownTimeoutMs: 4_500,
    onEvent: (event) => {
      fs.writeSync(1, `CLUSTER_EVENT:${event.type}:${event.message}\n`);
    },
  },
);

if (cluster.isPrimary) {
  fs.writeSync(1, 'PRIMARY_FINISHED\n');
}
