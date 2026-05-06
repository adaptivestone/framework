/**
 * Per-handler typed request aliases for `Auth`.
 *
 * Hand-written to validate the codegen type design across diverse route
 * shapes (with/without schemas, mixed wrapper styles). Once `framework gen`
 * (P1a-codegen) lands, this file will be CLI-emitted from AST analysis of
 * `Auth.ts` and regenerated on schema/middleware changes.
 *
 * Naming convention: each handler method on the controller produces one
 * exported type aliased `<MethodName>Request` (PascalCase). The type is keyed
 * by the handler method name, not by HTTP verb + path — so renaming the route
 * (POST → GET, or moving the path) doesn't touch handler signatures. If the
 * same method is wired to multiple routes (e.g. backward-compatible legacy
 * paths), the type is a union; narrow with `req.method` or `req.path`.
 *
 * Until codegen lands: edits to `Auth.ts`'s `routes` getter or middleware Map
 * require a matching edit here.
 */

import type GetUserByToken from '../services/http/middleware/GetUserByToken.ts';
import type RateLimiter from '../services/http/middleware/RateLimiter.ts';
import type {
  BaseRequestContext,
  UnionAppInfoProvides,
} from '../services/http/types.ts';
import type { StandardSchemaV1 } from '../services/validate/types.ts';
import type Auth from './Auth.ts';

/**
 * Type-level navigation into the controller's `routes` getter. Lets the gen
 * file reference inline schemas (defined inside `get routes()`) without
 * forcing every schema to become a separate named export.
 */
type AuthRoutes = InstanceType<typeof Auth>['routes'];

/**
 * Middleware tuple applied to every route on this controller, derived from
 * `static get middleware()` Map's `'/{*splat}'` entry (matches all paths on
 * all methods). Routes share this tuple because the Map has no per-route
 * overrides for any of `Auth`'s routes.
 */
type AuthMiddlewares = readonly [typeof GetUserByToken, typeof RateLimiter];

/** Request type for `Auth.postLogin`. Validates body against the inline schema. */
export type PostLoginRequest = BaseRequestContext & {
  appInfo: UnionAppInfoProvides<AuthMiddlewares> & {
    request: StandardSchemaV1.InferOutput<
      AuthRoutes['post']['/login']['request']
    >;
  };
};

/** Request type for `Auth.postRegister`. Schema includes optional name fields. */
export type PostRegisterRequest = BaseRequestContext & {
  appInfo: UnionAppInfoProvides<AuthMiddlewares> & {
    request: StandardSchemaV1.InferOutput<
      AuthRoutes['post']['/register']['request']
    >;
  };
};

/**
 * Request type for `Auth.postLogout`. Route is a bare method reference (no
 * `{ handler, request }` wrapper, no schema), so `request` keeps the default
 * `Record<string, unknown>` from `BaseAppInfo`. `appInfo.user?` flows in from
 * `GetUserByToken.provides`.
 */
export type PostLogoutRequest = BaseRequestContext & {
  appInfo: UnionAppInfoProvides<AuthMiddlewares>;
};

/**
 * Request type for `Auth.verifyUser`. Bare method ref, no schema; the handler
 * reads its input from `req.query.verification_token` rather than the body.
 */
export type VerifyUserRequest = BaseRequestContext & {
  appInfo: UnionAppInfoProvides<AuthMiddlewares>;
};

/** Request type for `Auth.sendPasswordRecoveryEmail`. */
export type SendPasswordRecoveryEmailRequest = BaseRequestContext & {
  appInfo: UnionAppInfoProvides<AuthMiddlewares> & {
    request: StandardSchemaV1.InferOutput<
      AuthRoutes['post']['/send-recovery-email']['request']
    >;
  };
};

/** Request type for `Auth.recoverPassword`. */
export type RecoverPasswordRequest = BaseRequestContext & {
  appInfo: UnionAppInfoProvides<AuthMiddlewares> & {
    request: StandardSchemaV1.InferOutput<
      AuthRoutes['post']['/recover-password']['request']
    >;
  };
};

/** Request type for `Auth.sendVerification`. */
export type SendVerificationRequest = BaseRequestContext & {
  appInfo: UnionAppInfoProvides<AuthMiddlewares> & {
    request: StandardSchemaV1.InferOutput<
      AuthRoutes['post']['/send-verification']['request']
    >;
  };
};
