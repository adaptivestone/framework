import type { NextFunction, Response } from 'express';
import type { IApp } from '../../../server.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';

class Cors extends AbstractMiddleware {
  constructor(
    app: IApp,
    params: {
      origins: (string | RegExp)[];
      /** Response headers browser code may read, e.g. `Retry-After`. */
      exposedHeaders?: string[];
    },
  ) {
    super(app);
    this.params = params;
    if (!Array.isArray(params?.origins) || !params.origins.length) {
      throw new Error('Cors inited without origin config');
    }
    // An unanchored regex matches more than intended — `/example\.com/` also
    // matches evil-example.com. Warn (don't change behavior) so the misconfig
    // is visible at boot.
    for (const origin of params.origins) {
      if (
        origin instanceof RegExp &&
        (!origin.source.startsWith('^') || !origin.source.endsWith('$'))
      ) {
        this.logger?.warn(
          `CORS regex /${origin.source}/ is not anchored — it can match unintended origins (e.g. evil-example.com). Anchor it with ^…$.`,
        );
      }
    }
  }

  static get description() {
    return 'Add CORS headers to request';
  }

  async middleware(req: FrameworkRequest, res: Response, next: NextFunction) {
    const origins = this.params?.origins;
    if (!Array.isArray(origins)) {
      return next();
    }
    // Whether the allow-origin header is sent depends on Origin, so every
    // response varies by it. `vary` appends instead of replacing other values.
    res.vary('Origin');
    for (const host of origins as (string | RegExp)[]) {
      if (
        (typeof host === 'string' && req.headers.origin === host) ||
        (host instanceof RegExp && host.test(req.headers.origin ?? ''))
      ) {
        res.set('Access-Control-Allow-Origin', req.headers.origin);

        if (req.method === 'OPTIONS') {
          res.set(
            'Access-Control-Allow-Methods',
            'GET,HEAD,PUT,PATCH,POST,DELETE',
          );
          res.vary('Access-Control-Request-Headers');

          const allowedHeaders = req.headers['access-control-request-headers'];
          if (allowedHeaders) {
            res.set('Access-Control-Allow-Headers', allowedHeaders);
          }
          res.set('Content-Length', '0');
          res.status(204);
          return res.end();
        }

        // Only the actual response needs it; a preflight ignores it.
        const exposedHeaders = this.params?.exposedHeaders as
          | string[]
          | undefined;
        if (exposedHeaders?.length) {
          res.set('Access-Control-Expose-Headers', exposedHeaders.join(', '));
        }
      }
    }
    return next();
  }
}

export default Cors;
