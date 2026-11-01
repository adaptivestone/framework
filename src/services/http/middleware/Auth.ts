import type { AppUser } from '../../../models/User.ts';
import { UnauthorizedError } from '../httpErrors.ts';
import type { Next } from '../RequestContext.ts';
import type { UserContext } from './GetUserByToken.ts';
import Middleware from './Middleware.ts';

class AuthMiddleware extends Middleware {
  static get description() {
    return 'Allow to pass only if the user provided. Please use any middleware that provide user instance before';
  }

  static get requiresAuth() {
    return true;
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

  async middleware(ctx: UserContext, next: Next) {
    if (!ctx.appInfo.user) {
      this.logger?.info('User try to access resource without credentials');
      throw new UnauthorizedError({
        code: 'AUTH001',
        i18nKey: 'middleware.auth.notLoggedIn',
        message: 'Please login to application',
      });
    }
    return next();
  }
}

export default AuthMiddleware;
