import type { Router } from 'express';
import type Base from './Base.js';

type TMiddleware = Array<Function | Array<Function, Array<any>>>;

class AbstractController extends Base {
  prefix: string;
  router: Router;
  constructor(app: Server['app'], prefix: string, isExpressMergeParams = false);

  /**
   * Parse middlewares to be an object.
   */
  parseMiddlewares(
    middlewareMap: Map<string, TMiddleware>,
    httpPath: string,
  ): Array<{
    name: string;
    method: string;
    path: string;
    fullPath: string;
    params: Array<any>;
    relatedQueryParameters?: any;
    authParams?: any;
    MiddlewareFunction: Function;
  }>;

  get routes(): {
    [method: string]: {
      [path: string]: {
        handler: Function;
        middleware?: TMiddleware;
        request?: any;
        query?: any;
      };
    };
  };

  /**
   * Array of middlewares to append for route
   * You should provide path relative to controller and then array of middlewares to apply.
   * Order is matter.
   * Be default path apply to ANY' method, but you can preattach 'METHOD' into patch to scope patch to this METHOD
   */
  static get middleware(): Map<string, TMiddleware>;

  getConstructorName(): string;

  /**
   * Get http path with inheritance of path
   */
  getHttpPath(): string;
}

export default AbstractController;
