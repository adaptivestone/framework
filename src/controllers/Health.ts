import { createHash, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import mongoose from 'mongoose';
import type healthConfig from '../config/health.ts';
import { translateWithDefault } from '../helpers/translate.ts';
import AbstractController, {
  type TMiddleware,
} from '../modules/AbstractController.ts';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';

const MONGO_PING_TIMEOUT_MS = 1000;

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** Ping MongoDB; false when disconnected, failing, or slower than the timeout. */
async function pingMongo(): Promise<boolean> {
  const { connection } = mongoose;
  if (connection.readyState !== 1 || !connection.db) {
    return false;
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      connection.db.command({ ping: 1 }),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('MongoDB ping timed out')),
          MONGO_PING_TIMEOUT_MS,
        );
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe endpoints for deploys, load balancers and orchestrators.
 * `GET /health/live` never touches a dependency (a failing liveness probe
 * restarts the process); `GET /health/ready` also pings MongoDB. Override this
 * controller in your app to add checks, middleware or another mount path.
 */
class Health extends AbstractController {
  get routes() {
    return {
      get: {
        '/live': this.live,
        '/ready': this.ready,
      },
    };
  }

  // Probes carry no user session: drop the inherited `[GetUserByToken, Auth]`.
  static get middleware(): Map<string, TMiddleware> {
    return new Map();
  }

  async live(req: FrameworkRequest, res: Response) {
    if (!this.isAuthorized(req)) {
      return this.unauthorized(req, res);
    }
    return res.json({ status: 'ok' });
  }

  async ready(req: FrameworkRequest, res: Response) {
    if (!this.isAuthorized(req)) {
      return this.unauthorized(req, res);
    }
    const mongo = (await pingMongo()) ? 'ok' : 'error';
    if (mongo === 'error') {
      this.logger?.warn('Health check failed: MongoDB ping');
    }
    return res
      .status(mongo === 'ok' ? 200 : 503)
      .json({ status: mongo, checks: { mongo } });
  }

  /** With `health.token` set, the request must carry it (`X-Health-Token` or `?token=`). */
  isAuthorized(req: FrameworkRequest) {
    const { token } = this.app.getConfig('health') as typeof healthConfig;
    if (!token) {
      return true;
    }
    const header = req.headers['x-health-token'];
    const sent = typeof header === 'string' ? header : req.query?.token;
    return (
      typeof sent === 'string' && timingSafeEqual(sha256(sent), sha256(token))
    );
  }

  unauthorized(req: FrameworkRequest, res: Response) {
    return res.status(401).json({
      message: translateWithDefault(req, 'health.unauthorized', 'Unauthorized'),
    });
  }
}

export default Health;
