import AbstractMiddleware from './AbstractMiddleware.ts';

import type { Response, NextFunction } from 'express';
import type { FrameworkRequest } from '../HttpServer.ts';
import type { IApp } from '../../../server.ts';

class Cors extends AbstractMiddleware {
  constructor(
    app: IApp,
    params: {
      origins: (string | RegExp)[];
    },
  ) {
    super(app);
    this.params = params;
    if (!Array.isArray(params?.origins) || !params.origins.length) {
      throw new Error('Cors inited without origin config');
    }
  }

  static get description() {
    return 'Add CORS headers to request';
  }

  async middleware(req: FrameworkRequest, res: Response, next: NextFunction) {
    for (const host of this.params?.origins as (string | RegExp)[]) {
      if (
        (typeof host === 'string' && req.headers.origin === host) ||
        (host instanceof RegExp && host.test(req.headers.origin ?? ''))
      ) {
        res.set('Access-Control-Allow-Origin', req.headers.origin);
        res.set('Vary', 'Origin');

        if (req.method === 'OPTIONS') {
          res.set(
            'Access-Control-Allow-Methods',
            'GET,HEAD,PUT,PATCH,POST,DELETE',
          );
          res.set('Vary', 'Origin, Access-Control-Request-Headers');

          const allowedHeaders = req.headers['access-control-request-headers'];
          if (allowedHeaders) {
            res.set('Access-Control-Allow-Headers', allowedHeaders);
          }
          res.set('Content-Length', '0');
          res.status(204);
          return res.end();
        }
      }
    }
    return next();
  }
}

export default Cors;
