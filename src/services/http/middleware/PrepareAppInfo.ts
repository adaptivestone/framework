import AbstractMiddleware from './AbstractMiddleware.ts';

import type { Response, NextFunction } from 'express';
import type { FrameworkRequest } from '../HttpServer.ts';

class PrepareAppInfo extends AbstractMiddleware {
  static get description() {
    return 'Basic middleware that creates "req.appInfo" object';
  }

  async middleware(req: FrameworkRequest, res: Response, next: NextFunction) {
    if (!req.appInfo) {
      //@ts-ignore
      req.appInfo = {
        app: this.app,
      };
    }
    next();
  }
}

export default PrepareAppInfo;
