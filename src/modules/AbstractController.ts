import type { IApp } from '../server.ts';
import type AbstractMiddleware from '../services/http/middleware/AbstractMiddleware.ts';
import Auth from '../services/http/middleware/Auth.ts';
import GetUserByToken from '../services/http/middleware/GetUserByToken.ts';
import type { BodyParsingMode } from '../services/http/routing/RouteNode.ts';
import type { RequestContentTypeMap } from '../services/validate/contentType.ts';
import type { StandardSchemaV1 } from '../services/validate/types.ts';
import Base from './Base.ts';

type MiddlewareWithParamsTuple = readonly [
  typeof AbstractMiddleware,
  Record<string, unknown>,
];
export type TMiddleware = Array<
  typeof AbstractMiddleware | MiddlewareWithParamsTuple
>;
// biome-ignore lint/complexity/noBannedTypes: Route handlers are generic callable values from user controllers
type RouteHandler = Function;
type RouteObject = {
  handler: RouteHandler;
  description?: string;
  middleware?: TMiddleware | null;
  /**
   * Body schema. Either a single Standard Schema (validates any body), or a
   * content-type map (`{ 'application/json': schema, 'multipart/form-data':
   * schema }`) validated by the request's `Content-Type` — mirrors OpenAPI's
   * `requestBody.content`. Media-type matching is case-insensitive and ignores
   * parameters (`; charset=...`). With a map, `req.appInfo.request` is a
   * discriminated union keyed by a reserved `contentType` field — it holds the
   * matched media type and overwrites any body field of the same name, so do
   * not declare a schema field named `contentType`.
   */
  request?: StandardSchemaV1 | RequestContentTypeMap | null;
  query?: StandardSchemaV1 | null;
  /**
   * Per-route body parsing mode. Only `'parsed'` (the default) takes effect
   * today; `'raw'` and `'none'` are reserved for v5.1 and currently do nothing
   * (the parser runs globally). See {@link BodyParsingMode}.
   */
  bodyParsing?: BodyParsingMode;
};

export type RouteParams = {
  [method: string]: {
    [path: string]: RouteObject | RouteHandler;
  };
};

/**
 * Convert a physical controller-folder prefix into its URL prefix. A fully
 * parenthesized segment is a route-transparent organizational group:
 * `(group)/admin` becomes `admin`. Both runtime loading and AST codegen call
 * the default-path helper below, so the convention cannot drift between them.
 */
export function controllerRoutePrefix(prefix: string): string {
  return prefix
    .split(/[\\/]+/)
    .filter(
      (segment) =>
        segment.length > 0 &&
        !(segment.startsWith('(') && segment.endsWith(')')),
    )
    .join('/');
}

/**
 * The default mount segment for a controller: `ClassName`, prefixed by the
 * route-bearing folders when nested (`admin/Users.ts` → `Admin/Users`). Exported
 * so codegen computes the same mount path as the runtime instance method below
 * — the two must never drift on where a controller mounts (see codegen doc 06).
 */
export function controllerConstructorName(
  prefix: string,
  className: string,
): string {
  const routePrefix = controllerRoutePrefix(prefix);
  return routePrefix
    ? `${routePrefix.charAt(0).toUpperCase()}${routePrefix.slice(1)}/${className}`
    : className;
}

/** Default HTTP mount path for a controller that doesn't override `getHttpPath`. */
export function defaultControllerHttpPath(
  prefix: string,
  className: string,
): string {
  return `/${controllerConstructorName(prefix, className).toLowerCase()}`.replace(
    '//',
    '/',
  );
}

/**
 * Abstract controller. You should extend any controller from them.
 * Place you cintroller into controller folder and it be inited in auto way.
 * By default name of route will be controller name not file name. But please name it in same ways.
 * You can overwrite base controllers byt creating controllers with tha same file name (yes file name, not class name)
 * In most cases you will want to have a 'home' route that not include controller name. For this case please check '  getHttpPath'
 */
class AbstractController extends Base {
  prefix = '';

  constructor(app: IApp, prefix: string) {
    super(app);
    this.prefix = prefix;
  }

  /**
   * Object with routes. Routes relative to controller
   * @example
   * return {
   *   post: {
   *     "/someUrl": {
   *       handler: this.postSomeUrl,
   *       request: yup.object().shape({
   *         count: yup.number().max(100)required(),
   *       })
   *     }
   *   },
   * };
   */
  get routes(): RouteParams {
    this.logger?.warn('Please implement "routes" method on controller.');
    return {};
  }

  /**
   * Array of middlewares to append for route
   * You should provide path relative to controller and then array of middlewares to apply.
   * Order is matter.
   * Be default path apply to ANY' method, but you can preattach 'METHOD' into patch to scope patch to this METHOD
   * @example
   * return new Map([
   *    ['/{*splat}', [GetUserByToken]] // for any method for this controller
   *    ['POST/', [Auth]] // for POST method
   *    ['/superSecretMethod', [OnlySuperSecretUsers]] // route with ANY method
   *    ['PUT/superSecretMathod', [OnlySuperSecretAdmin]] // route with PUT method
   * ]);
   */
  static get middleware(): Map<string, TMiddleware> {
    return new Map([['/{*splat}', [GetUserByToken, Auth]]]);
  }

  /**
   * Get constructor name that can include preix
   */
  getConstructorName() {
    return controllerConstructorName(this.prefix, this.constructor.name);
  }

  /**
   * Get http path with inheritance of path
   */
  getHttpPath() {
    return defaultControllerHttpPath(this.prefix, this.constructor.name);
  }

  static get loggerGroup() {
    return 'controller';
  }
}

export default AbstractController;
