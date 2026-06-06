import type { NextFunction, Response } from 'express';
import type { AppUser } from '../../../models/User.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import type { GetUserByTokenAppInfo } from '../middleware/GetUserByToken.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';

class AuthMiddleware extends AbstractMiddleware {
  static get description() {
    return 'Allow to pass only if the user provided. Please use any middleware that provide user instance before';
  }

  /**
   * Type-only phantom (codegen reads it; runtime ignores it — see
   * `GetUserByToken.provides`). Auth rejects unauthenticated requests at
   * runtime, so past this point `appInfo.user` is guaranteed present. Declaring
   * it as a *required* `user` narrows the optional `user?` that
   * `GetUserByToken` contributes: `UnionAppInfoProvides` intersects the shapes,
   * and `{ user?: U } & { user: U }` collapses to `{ user: U }`. Handlers
   * behind `Auth` then read `appInfo.user` without a guard.
   */
  static get provides() {
    return {} as { user: AppUser };
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
