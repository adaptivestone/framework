import AbstractMiddleware from './AbstractMiddleware.ts';

import type { Response, NextFunction } from 'express';
import type { FrameworkRequest } from '../HttpServer.ts';
import type { GetUserByTokenAppInfo } from '../middleware/GetUserByToken.ts';

class AuthMiddleware extends AbstractMiddleware {
  static get description() {
    return 'Allow to pass only if the user provided. Please use any middleware that provide user instance before';
  }

  async middleware(
    req: FrameworkRequest & GetUserByTokenAppInfo,
    res: Response,
    next: NextFunction,
  ) {
    if (!req.appInfo.user) {
      this.logger?.info('User try to access resource without credentials');
      return res.status(401).json({
        error: 'AUTH001',
        message: 'Please login to application',
      });
    }
    return next();
  }
}

export default AuthMiddleware;
