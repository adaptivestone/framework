import type { NextFunction, Response } from 'express';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';

class PrepareAppInfo extends AbstractMiddleware {
  static get description() {
    return 'Basic middleware that creates "req.appInfo" object';
  }

  async middleware(req: FrameworkRequest, res: Response, next: NextFunction) {
    if (!req.appInfo) {
      //@ts-expect-error extending
      req.appInfo = {
        app: this.app,
      };
    }
    next();
  }
}

export default PrepareAppInfo;
