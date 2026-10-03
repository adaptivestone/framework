import type { NextFunction, Response } from 'express';
import type { TUser } from '../../../models/User.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import { ForbiddenError, UnauthorizedError } from '../httpErrors.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';
import type { GetUserByTokenAppInfo } from './GetUserByToken.ts';

class RoleMiddleware extends AbstractMiddleware {
  static get description() {
    return 'Check user role (user.roles property). If the user has no role then stop request and return error. OR logic (any role will pass user)';
  }

  static get requiresAuth() {
    return true;
  }

  async middleware(
    req: FrameworkRequest &
      GetUserByTokenAppInfo & { user: InstanceType<TUser> },
    _res: Response,
    next: NextFunction,
  ) {
    const { user } = req.appInfo;

    if (!user) {
      // Same meaning for the client as the Auth 401: log in first.
      throw new UnauthorizedError({
        code: 'AUTH001',
        i18nKey: 'middleware.role.userRequired',
        message: 'User should be provided',
      });
    }

    // Guard against `Role` being mounted without a `roles` param: treat a
    // missing list as "no role grants access" (fail closed) instead of throwing.
    const allowedRoles = (this.params?.roles as Array<string>) ?? [];
    let hasRole = false;
    user.roles?.forEach((role: string) => {
      if (allowedRoles.includes(role)) {
        hasRole = true;
      }
    });

    if (!hasRole) {
      throw new ForbiddenError({
        code: 'NO_ACCESS',
        i18nKey: 'middleware.role.noAccess',
        message: 'You do not have access',
      });
    }
    return next();
  }
}

export default RoleMiddleware;
