import type { NextFunction, Response } from 'express';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';

class PrepareAppInfo extends AbstractMiddleware {
  static get description() {
    return 'Basic middleware that creates "req.appInfo" object';
  }

  async middleware(req: FrameworkRequest, _res: Response, next: NextFunction) {
    if (!req.appInfo) {
      // `request`/`query` are declared non-optional; seed both so a schema-less
      // route's handler can read them. The validation wrapper overwrites
      // (assigns, not merges) when a route/middleware declares schemas, so
      // these defaults never leak stale keys. `ip`/`i18n` are optional and set
      // by later middleware.
      req.appInfo = {
        app: this.app,
        request: {},
        query: {},
      };
    }
    next();
  }
}

export default PrepareAppInfo;
