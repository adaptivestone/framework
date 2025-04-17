import express from 'express';
import type { IRouter, Response, NextFunction } from 'express';

import Base from './Base.ts';
import GetUserByToken from '../services/http/middleware/GetUserByToken.ts';
import Auth from '../services/http/middleware/Auth.ts';
import ValidateService from '../services/validate/ValidateService.js';
import DocumentationGenerator from '../services/documentation/DocumentationGenerator.js';

import type { IApp } from '../server.ts';
import type AbstractMiddleware from '../services/http/middleware/AbstractMiddleware.ts';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';
type MiddlewareWithParamsTuple = [
  typeof AbstractMiddleware,
  Record<string, any>,
];
export type TMiddleware = Array<
  typeof AbstractMiddleware | MiddlewareWithParamsTuple
>;
type RouteObject = {
  handler: Function;
  description?: string;
  middleware?: TMiddleware | null;
  request?: any;
  query?: any;
};

export type RouteParams = {
  [method: string]: {
    [path: string]: RouteObject | Function;
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
  router: IRouter;

  constructor(app: IApp, prefix: string, isExpressMergeParams = false) {
    const time = Date.now();
    super(app);
    this.prefix = prefix;
    this.router = express.Router({
      mergeParams: isExpressMergeParams,
    });
    const { routes } = this;
    const httpPath = this.getHttpPath();

    /**
     * Grab route middleware onlo one Map
     */
    const routeMiddlewares = new Map();
    Object.entries(routes).forEach(([method, methodRoutes]) => {
      Object.entries(methodRoutes).forEach(([route, routeParam]) => {
        if (
          typeof routeParam === 'object' &&
          routeParam !== null &&
          'middleware' in routeParam &&
          routeParam.middleware
        ) {
          const fullRoute = method.toUpperCase() + route;

          if (!routeMiddlewares.has(fullRoute)) {
            routeMiddlewares.set(fullRoute, []);
          }

          routeMiddlewares.set(fullRoute, [
            ...routeMiddlewares.get(fullRoute),
            ...routeParam.middleware,
          ]);
        }
      });
    });

    const routeMiddlewaresReg = this.parseMiddlewares(
      routeMiddlewares,
      httpPath,
    );
    const middlewaresInfo = this.parseMiddlewares(
      (this.constructor as typeof AbstractController).middleware,
      httpPath,
    );

    const routesInfo = [];

    /**
     *  Register controller middleware
     */
    for (const middleware of middlewaresInfo) {
      (this.router[middleware.method as keyof IRouter] as Function)(
        middleware.path,
        new middleware.MiddlewareFunction(
          this.app,
          middleware.params,
        ).getMiddleware(),
      );
    }

    /**
     *  Register routes itself
     */
    for (const verb in routes) {
      if (typeof this.router[verb as keyof IRouter] !== 'function') {
        this.logger?.error(
          `Method ${verb} not exist for router. Please check your codebase`,
        );
        continue;
      }
      for (const path in routes[verb]) {
        const routeAdditionalMiddlewares = routeMiddlewaresReg.filter(
          (middleware) =>
            middleware.path === path && middleware.method === verb,
        );

        let routeObject = routes[verb][path] as RouteObject;
        if (Object.prototype.toString.call(routeObject) !== '[object Object]') {
          // for support firect pass function instead of object
          routeObject = {
            handler: routeObject as unknown as Function,
            request: null,
            query: null,
            middleware: null,
          };

          if (typeof routeObject.handler !== 'function') {
            this.logger?.error(
              `Can't resolve function '${
                routeObject.handler
              }' for controller '${this.getConstructorName()}'`,
            );
            continue;
          }
        }

        const handler = routeObject.handler;
        let fnName: string | undefined;
        if (typeof handler === 'function') {
          fnName = handler.name;
        } else {
          fnName = undefined;
        }

        const fullPath = `/${httpPath}/${path}`
          .split('//')
          .join('/')
          .split('//')
          .join('/');

        routesInfo.push({
          name: fnName,
          description: routeObject?.description,
          method: verb.toUpperCase(),
          fields: routeObject?.request?.fields,
          queryFields: routeObject?.query?.fields,
          path,
          fullPath,
        });
        // this.logger.verbose(
        //   `Controller '${this.getConstructorName()}' register function '${fnName}'  for method '${verb}' and path '${path}' Full path '${fullPath}'`,
        // );

        let additionalMiddlewares;

        if (routeAdditionalMiddlewares.length > 0) {
          additionalMiddlewares = Array.from(
            routeAdditionalMiddlewares,
            ({ MiddlewareFunction, params }) =>
              new MiddlewareFunction(this.app, params).getMiddleware(),
          );
        }

        (this.router[verb as keyof IRouter] as Function)(
          path,
          additionalMiddlewares || [],
          async (req: FrameworkRequest, res: Response, next: NextFunction) => {
            const requestObj = {
              query: req.query,
              body: req.body,
              appInfo: req.appInfo,
            };
            try {
              req.appInfo.request = await new ValidateService(
                this.app,
                routeObject?.request,
              ).validateReqData(requestObj, {
                selectedReqData: req.body,
                additionalMiddlewareFieldsData: {
                  middlewaresInfo,
                  routeMiddlewaresReg,
                  options: {
                    method: verb,
                    path: fullPath,
                    prefix: 'request',
                  },
                },
              });
              req.appInfo.query = await new ValidateService(
                this.app,
                routeObject?.query,
              ).validateReqData(requestObj, {
                selectedReqData: req.query,
                additionalMiddlewareFieldsData: {
                  middlewaresInfo,
                  routeMiddlewaresReg,
                  options: {
                    method: verb,
                    path: fullPath,
                    prefix: 'query',
                  },
                },
              });
            } catch (err: any) {
              return res.status(400).json({
                errors: err.message,
              });
            }
            // req.body = new Proxy(req.body, {
            //   get: (target, prop) => {
            //     this.logger.warn(
            //       'Please not use "req.body" directly. Implement "request" and use "req.appInfo.request" ',
            //     );
            //     return target[prop];
            //   },
            // });
            // req.query = new Proxy(req.query, {
            //   get: (target, prop) => {
            //     this.logger.warn(
            //       'Please not use "req.query" directly. Implement "query" and use "req.appInfo.query" ',
            //     );
            //     return target[prop];
            //   },
            // });

            if (!routeObject.handler) {
              this.logger?.error(`Route object have no handler defined`);
              return res.status(500).json({
                message:
                  'Platform error 2. Please check later or contact support',
              });
            }

            if (routeObject.handler.constructor.name !== 'AsyncFunction') {
              const error =
                "Handler should be AsyncFunction. Perhabs you miss 'async' of function declaration?";
              this.logger?.error(error);
              return res.status(500).json({
                message:
                  'Platform error. Please check later or contact support',
              });
            }
            return routeObject.handler
              .call(this, req, res, next)
              .catch((e: Error) => {
                this.logger?.error(e);
                return res.status(500).json({
                  message:
                    'Platform error. Please check later or contact support',
                });
              });
          },
        );
      }
    }

    /**
     * Generate text info
     */
    const text = ['', `Controller '${this.getConstructorName()}' registered.`];

    const reports: { [key: string]: any[] } = {
      'Middlewares:': middlewaresInfo,
      'Route middlewares:': routeMiddlewaresReg,
      'Callbacks:': routesInfo,
    };
    for (const key in reports) {
      text.push(`${key}`);
      for (const item of reports[key]) {
        text.push(
          `Path:'${item.path}'. Full path: '${
            item.fullPath
          }'. Method: '${item.method.toUpperCase()}'. Function: '${item.name}'`,
        );
      }
    }

    text.push(`Time: ${Date.now() - time} ms`);

    this.logger?.verbose(text.join('\n'));

    /**
     * Generate documentation
     */
    if (!this.app.httpServer) {
      this.app.documentation?.push(
        new DocumentationGenerator(this.app).convertDataToDocumentationElement(
          this.getConstructorName(),
          routesInfo,
          middlewaresInfo,
          routeMiddlewaresReg,
        ),
      );
    } else {
      this.app.httpServer.express.use(httpPath, this.router);
    }
  }

  /**
   * Parse middlewares to be an object.
   */
  parseMiddlewares(middlewareMap: Map<string, TMiddleware>, httpPath: string) {
    const middlewaresInfo = [];
    // eslint-disable-next-line prefer-const
    for (let [path, middleware] of middlewareMap) {
      if (!Array.isArray(middleware)) {
        middleware = [middleware];
      }
      for (const M of middleware) {
        let method = 'all';
        let realPath = path;
        if (typeof realPath !== 'string') {
          this.logger?.error(`Path not a string ${realPath}. Please check it`);
          continue;
        }
        if (!realPath.startsWith('/')) {
          method = realPath.split('/')[0]?.toLowerCase();
          if (!method) {
            this.logger?.error(`Method not found for ${realPath}`);
            continue;
          }
          realPath = realPath.substring(method.length);
        }
        if (typeof this.router[method as keyof IRouter] !== 'function') {
          this.logger?.error(
            `Method ${method} not exist for middleware. Please check your codebase`,
          );
          continue;
        }
        const fullPath = `/${httpPath}/${realPath.toUpperCase()}`
          .split('//')
          .join('/')
          .split('//')
          .join('/');
        let MiddlewareFunction: typeof AbstractMiddleware;
        let middlewareParams = {};
        if (Array.isArray(M)) {
          [MiddlewareFunction, middlewareParams] = M;
        } else {
          MiddlewareFunction = M;
        }

        middlewaresInfo.push({
          name: MiddlewareFunction.name,
          method,
          path: realPath,
          fullPath,
          params: middlewareParams,
          relatedQueryParameters: new MiddlewareFunction(
            this.app,
            middlewareParams,
          )?.relatedQueryParameters,
          authParams: new MiddlewareFunction(this.app, middlewareParams)
            ?.usedAuthParameters,
          MiddlewareFunction,
        });
      }
    }
    return middlewaresInfo;
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
