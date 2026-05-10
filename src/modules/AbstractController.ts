import type { IApp } from '../server.ts';
import type AbstractMiddleware from '../services/http/middleware/AbstractMiddleware.ts';
import Auth from '../services/http/middleware/Auth.ts';
import GetUserByToken from '../services/http/middleware/GetUserByToken.ts';
import type { BodyParsingMode } from '../services/http/routing/RouteNode.ts';
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
  request?: StandardSchemaV1 | null;
  query?: StandardSchemaV1 | null;
  bodyParsing?: BodyParsingMode;
};

export type RouteParams = {
  [method: string]: {
    [path: string]: RouteObject | RouteHandler;
  };
};

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
    if (this.prefix) {
      return `${this.prefix.charAt(0).toUpperCase()}${this.prefix.slice(1)}/${
        this.constructor.name
      }`;
    }
    return this.constructor.name;
  }

  /**
   * Get http path with inheritance of path
   */
  getHttpPath() {
    return `/${this.getConstructorName().toLowerCase()}`.replace('//', '/');
  }

  static get loggerGroup() {
    return 'controller';
  }
}

export default AbstractController;
