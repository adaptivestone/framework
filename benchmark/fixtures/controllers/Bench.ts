import { setTimeout as sleep } from 'node:timers/promises';
import type { Response } from 'express';
import { object, string } from 'yup';
import AbstractController from '../../../src/modules/AbstractController.ts';
import type { FrameworkRequest } from '../../../src/services/http/HttpServer.ts';
import GetUserByToken from '../../../src/services/http/middleware/GetUserByToken.ts';

/**
 * Benchmark routes. Handlers use the 5.x `(req, res)` form so the same file
 * runs on the 5.6.0 tag and on later commits (`benchmark/real-runner.mjs`).
 */
class Bench extends AbstractController {
  get routes() {
    return {
      get: {
        '/plaintext': this.plaintext,
        '/echo': {
          handler: this.echo,
          query: object().shape({
            name: string().required(),
          }),
        },
        // One route middleware that continues (no token → next()).
        '/chain': { handler: this.chain, middleware: [GetUserByToken] },
        // Held open for a second: memory per pending request.
        '/hold': this.hold,
        // Server-side memory and CPU, after a full GC when `?gc=1`.
        '/stats': this.stats,
      },
      post: {
        '/echo': {
          handler: this.postEcho,
          request: object().shape({
            name: string().required(),
          }),
        },
      },
    };
  }

  async plaintext(_req: FrameworkRequest, res: Response) {
    return res.json({ hello: 'world' });
  }

  async chain(_req: FrameworkRequest, res: Response) {
    return res.json({ chain: true });
  }

  async echo(
    req: FrameworkRequest & {
      appInfo: { query: { name: string } };
    },
    res: Response,
  ) {
    const message =
      req.appInfo.i18n?.t('auth.userProvided', {
        defaultValue: 'User not specified',
      }) ?? 'User not specified';
    return res.json({ name: req.appInfo.query.name, message });
  }

  async postEcho(
    req: FrameworkRequest & { appInfo: { request: { name: string } } },
    res: Response,
  ) {
    return res.status(201).json({ name: req.appInfo.request.name });
  }

  async hold(_req: FrameworkRequest, res: Response) {
    await sleep(1000);
    return res.json({ held: true });
  }

  async stats(req: FrameworkRequest, res: Response) {
    if (req.query.gc) {
      const g = globalThis as {
        gc?: () => void;
        Bun?: { gc: (force: boolean) => void };
      };
      for (let i = 0; i < 2; i += 1) {
        if (g.gc) {
          g.gc();
        } else {
          g.Bun?.gc(true);
        }
      }
    }
    return res.json({ memory: process.memoryUsage(), cpu: process.cpuUsage() });
  }

  static get middleware() {
    return new Map();
  }
}

export default Bench;
