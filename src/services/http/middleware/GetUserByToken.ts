import type { AppUser, TUser } from '../../../models/User.ts';
import type { Next, RequestContext } from '../RequestContext.ts';
import type { AppInfoExtensions, BaseAppInfo } from '../types.ts';
import Middleware from './Middleware.ts';

export interface GetUserByTokenAppInfo {
  appInfo: {
    user?: AppUser;
  };
}

/** The context behind `GetUserByToken`: `appInfo.user` when a token resolved. */
export type UserContext = RequestContext<
  BaseAppInfo & AppInfoExtensions & GetUserByTokenAppInfo['appInfo']
>;

/** Where a bearer token can come from: a request or a request context. */
export interface TokenSource {
  readonly body?: unknown;
  header(name: string): string | undefined;
}

class GetUserByToken extends Middleware {
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

  static get authSchemes() {
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

  /** @deprecated Renamed to {@link authSchemes}; removed in v6. */
  static get usedAuthParameters() {
    return GetUserByToken.authSchemes;
  }

  // Back-compat for any runtime reader of the instance form (removed in v6).
  get usedAuthParameters() {
    return GetUserByToken.authSchemes;
  }

  /**
   * Resolve the bearer token a request presents, applying the auth precedence:
   * body `token` first, then the `Authorization` header. A literal `'null'`
   * header value counts as absent. The `Bearer` prefix is stripped and the
   * result trimmed. Returns `undefined` when no token is present. Shared with
   * `postLogout` so both revoke the exact session the request authenticated with.
   */
  static resolveToken(req: TokenSource): string | undefined {
    const bodyToken = (req.body as { token?: unknown } | undefined)?.token;
    // A JSON `{"token": 123}` or a repeated form field (parsed as an array)
    // reaches here before schema validation — a non-string body token is
    // treated as absent, never passed to a string method.
    let token = typeof bodyToken === 'string' ? bodyToken : undefined;
    if (!token) {
      token = req.header('authorization');
      // Some clients serialize a missing token as the literal string "null"
      // (e.g. `Authorization: null`) — treat that as absent, not a real token.
      if (!token || token === 'null') {
        return undefined;
      }
    }
    return token.replace(/^Bearer\s+/i, '').trim();
  }

  async middleware(ctx: UserContext, next: Next) {
    if (ctx.appInfo.user) {
      this.logger?.warn('You call GetUserByToken more then once');
      return next();
    }
    const token = (ctx.body as { token?: unknown } | undefined)?.token;
    // Log presence only — never the token value or the Authorization header
    // (they are live bearer credentials).
    this.logger?.verbose(
      `GetUserByToken: body token ${
        token ? 'present' : 'absent'
      }, Authorization header ${ctx.header('authorization') ? 'present' : 'absent'}`,
    );
    const rawToken = GetUserByToken.resolveToken(ctx);
    if (!rawToken) {
      return next();
    }
    const User = this.app.getModel('User') as unknown as TUser;
    const user = (await User.getUserByToken(
      rawToken,
    )) as unknown as InstanceType<TUser>;
    if (user) {
      ctx.appInfo.user = user as unknown as AppUser;
    }
    return next();
  }
}

export default GetUserByToken;
