import type { NextFunction, Response } from 'express';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';

class RequestLogger extends AbstractMiddleware {
  static get description() {
    return 'Log info about the request';
  }

  async middleware(req: FrameworkRequest, res: Response, next: NextFunction) {
    const startTime = performance.now();
    const text = `Request is  [${req.method}] ${req.url}`;
    this.logger?.info(text);
    res.on('finish', () => {
      const end = performance.now();
      this.logger?.info(
        `Finished ${text}. Status: ${res.statusCode}.  [${(end - startTime).toFixed(2)} ms]`,
      );
    });
    next();
  }
}

export default RequestLogger;
