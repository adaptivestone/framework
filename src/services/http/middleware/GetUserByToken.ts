import AbstractMiddleware from './AbstractMiddleware.ts';
import type { Response, NextFunction } from 'express';
import type { FrameworkRequest } from '../HttpServer.ts';

export interface GetUserByTokenAppInfo {
  appInfo: {
    user?: any; // TODO
  };
}

class GetUserByToken extends AbstractMiddleware {
  static get description() {
    return 'Grab a token and try to parse the user from it. It user exist will add req.appInfo.user variable';
  }

  // eslint-disable-next-line class-methods-use-this
  get usedAuthParameters() {
    return [
      {
        name: 'Authorization',
        type: 'apiKey',
        in: 'header',
        description: GetUserByToken.description,
      },
    ];
  }

  async middleware(
    req: FrameworkRequest & GetUserByTokenAppInfo,
    res: Response,
    next: NextFunction,
  ) {
    if (req.appInfo.user) {
      this.logger?.warn('You call GetUserByToken more then once');
      return next();
    }
    let { token } = req.body || {};
    this.logger?.verbose(
      `GetUserByToken token in BODY ${token}. Token in Authorization header ${req.get(
        'Authorization',
      )}`,
    );
    if (!token) {
      token = req.get('Authorization');
      if (!token || token === 'null') {
        // is null express bug*
        return next();
      }
    }
    const User = this.app.getModel('User');
    const user = await User.getUserByToken(token);
    if (user) {
      req.appInfo.user = user;
    }
    return next();
  }
}

export default GetUserByToken;
