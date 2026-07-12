import type { NextFunction, Response } from 'express';
import type { AppUser, TUser } from '../../../models/User.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';

export interface GetUserByTokenAppInfo {
  appInfo: {
    user?: AppUser;
  };
}

class GetUserByToken extends AbstractMiddleware {
  static get description() {
    return 'Grab a token and try to parse the user from it. It user exist will add req.appInfo.user variable';
  }

  /**
   * Type-only phantom: declares what this middleware contributes to
   * `req.appInfo`. Codegen reads this to type per-route `Request<M, P>`;
   * runtime ignores it. The returned object is always `{}` — only the cast
   * type matters.
   */
  static get provides() {
    return {} as { user?: AppUser };
  }

  static get usedAuthParameters() {
    return [
      {
        name: 'Authorization',
        type: 'apiKey',
        in: 'header',
        description: GetUserByToken.description,
      },
      {
        name: 'bearerAuth',
        type: 'http',
        scheme: 'bearer',
        description: GetUserByToken.description,
      },
    ];
  }

  // Back-compat for any runtime reader of the instance form (removed in v6).
  get usedAuthParameters() {
    return GetUserByToken.usedAuthParameters;
  }

  /**
   * Resolve the bearer token a request presents, applying the auth precedence:
   * body `token` first, then the `Authorization` header. A literal `'null'`
   * header value counts as absent. The `Bearer` prefix is stripped and the
   * result trimmed. Returns `undefined` when no token is present. Shared with
   * `postLogout` so both revoke the exact session the request authenticated with.
   */
  static resolveToken(req: FrameworkRequest): string | undefined {
    const bodyToken = (req.body as { token?: unknown } | undefined)?.token;
    // A JSON `{"token": 123}` or a repeated form field (parsed as an array)
    // reaches here before schema validation — a non-string body token is
    // treated as absent, never passed to a string method.
    let token = typeof bodyToken === 'string' ? bodyToken : undefined;
    if (!token) {
      token = req.get('Authorization');
      // Some clients serialize a missing token as the literal string "null"
      // (e.g. `Authorization: null`) — treat that as absent, not a real token.
      if (!token || token === 'null') {
        return undefined;
      }
    }
    return token.replace(/^Bearer\s+/i, '').trim();
  }

  async middleware(
    req: FrameworkRequest & GetUserByTokenAppInfo,
    _res: Response,
    next: NextFunction,
  ) {
    if (req.appInfo.user) {
      this.logger?.warn('You call GetUserByToken more then once');
      return next();
    }
    const { token } = req.body || {};
    // Log presence only — never the token value or the Authorization header
    // (they are live bearer credentials).
    this.logger?.verbose(
      `GetUserByToken: body token ${
        token ? 'present' : 'absent'
      }, Authorization header ${req.get('Authorization') ? 'present' : 'absent'}`,
    );
    const rawToken = GetUserByToken.resolveToken(req);
    if (!rawToken) {
      return next();
    }
    const User = this.app.getModel('User') as unknown as TUser;
    const user = (await User.getUserByToken(
      rawToken,
    )) as unknown as InstanceType<TUser>;
    if (user) {
      req.appInfo.user = user;
    }
    return next();
  }
}

export default GetUserByToken;
