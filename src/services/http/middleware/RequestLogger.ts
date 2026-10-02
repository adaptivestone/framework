import type { NextFunction, Response } from 'express';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';

class RequestLogger extends AbstractMiddleware {
  static get description() {
    return 'Log info about the request';
  }

  async middleware(req: FrameworkRequest, res: Response, next: NextFunction) {
    const startTime = performance.now();
    // Log the path only, not `req.url` — the query string can carry secrets
    // (e.g. `/auth/verify?verification_token=…`).
    const text = `Request is  [${req.method}] ${req.path}`;
    // Probes hit the built-in Health controller (default mount) every few
    // seconds: log them only when they fail.
    const isProbe = req.path.startsWith('/health/');
    if (!isProbe) {
      this.logger?.info(text);
    }
    res.on('finish', () => {
      if (isProbe && res.statusCode < 400) {
        return;
      }
      const end = performance.now();
      this.logger?.[isProbe ? 'warn' : 'info'](
        `Finished ${text}. Status: ${res.statusCode}.  [${(end - startTime).toFixed(2)} ms]`,
      );
    });
    next();
  }
}

export default RequestLogger;
