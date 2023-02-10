/* eslint-disable array-callback-return */
/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
const express = require('express');
const Base = require('./Base');
const GetUserByToken = require('../services/http/middleware/GetUserByToken');
const Auth = require('../services/http/middleware/Auth');
const ValidateService = require('../services/validate/ValidateService');
const DocumentationGenerator = require('../services/documentation/DocumentationGenerator');
/**
 * Abstract controller. You should extend any controller from them.
 * Place you cintroller into controller folder and it be inited in auto way.
 * By default name of route will be controller name not file name. But please name it in same ways.
 * You can overwrite base controllers byt creating controllers with tha same file name (yes file name, not class name)
 * In most cases you will want to have a 'home' route that not include controller name. For this case please check 'getExpressPath'
 */
class AbstractController extends Base {
  constructor(app, prefix, isExpressMergeParams = false) {
    const time = Date.now();
    super(app);
    this.prefix = prefix;
    this.router = express.Router({
      mergeParams: isExpressMergeParams,
    });
    const { routes } = this;
    const expressPath = this.getExpressPath();

    /**
     * Grab route middleware onlo one Map
     */
    const routeMiddlewares = new Map();
    Object.entries(routes).forEach(([method, methodRoutes]) => {
      Object.entries(methodRoutes).forEach(([route, routeParam]) => {
        if (routeParam?.middleware) {
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

    /**
     * Parse middlewares to be an object.
     */
    const parseMiddlewares = (middlewareMap) => {
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
            this.logger.error(`Path not a string ${realPath}. Please check it`);
            // eslint-disable-next-line no-continue
            continue;
          }
          if (!realPath.startsWith('/')) {
            method = realPath.split('/')[0]?.toLowerCase();
            if (!method) {
              this.logger.error(`Method not found for ${realPath}`);
              // eslint-disable-next-line no-continue
              continue;
            }
            realPath = realPath.substring(method.length);
          }
          if (typeof this.router[method] !== 'function') {
            this.logger.error(
              `Method ${method} not exist for middleware. Please check your codebase`,
            );
            // eslint-disable-next-line no-continue
            continue;
          }
          const fullPath = `/${expressPath}/${realPath.toUpperCase()}`
            .split('//')
            .join('/')
            .split('//')
            .join('/');
          let MiddlewareFunction = M;
          let middlewareParams = {};
          if (Array.isArray(M)) {
            [MiddlewareFunction, middlewareParams] = M;
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
    };

    const routeMiddlewaresReg = parseMiddlewares(routeMiddlewares);
    const middlewaresInfo = parseMiddlewares(this.constructor.middleware);

    const routesInfo = [];

    /**
     *  Register controller middleware
     */
    for (const middleware of middlewaresInfo) {
      this.router[middleware.method](
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
      if (typeof this.router[verb] !== 'function') {
        this.logger.error(
          `Method ${verb} not exist for router. Please check your codebase`,
        );
        // eslint-disable-next-line no-continue
        continue;
      }
      for (const path in routes[verb]) {
        const routeAdditionalMiddlewares = routeMiddlewaresReg.filter(
          (middleware) =>
            middleware.path === path && middleware.method === verb,
        );

        let routeObject = routes[verb][path];
        if (Object.prototype.toString.call(routeObject) !== '[object Object]') {
          routeObject = {
            handler: routeObject,
            request: null,
            query: null,
            middleware: null,
          };

          if (typeof routeObject.handler !== 'function') {
            this.logger.error(
              `Can't resolve function '${
                routeObject.handler
              }' for controller '${this.getConstructorName()}'`,
            );
            // eslint-disable-next-line no-continue
            continue;
          }
        }

        let fnName = routeObject.handler;
        if (typeof fnName === 'function') {
          fnName = fnName.name;
        }

        const fullPath = `/${expressPath}/${path}`
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

        this.router[verb](
          path,
          additionalMiddlewares || [],
          async (req, res, next) => {
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
            } catch (err) {
              return res.status(400).json({
                errors: err.message,
              });
            }
            req.body = new Proxy(req.body, {
              get: (target, prop) => {
                this.logger.warn(
                  'Please not use "req.body" directly. Implement "request" and use "req.appInfo.request" ',
                );
                return target[prop];
              },
            });
            req.query = new Proxy(req.query, {
              get: (target, prop) => {
                this.logger.warn(
                  'Please not use "req.query" directly. Implement "query" and use "req.appInfo.query" ',
                );
                return target[prop];
              },
            });

            if (!routeObject.handler) {
              this.logger.error(`Route object have no handler defined`);
              return res.status(500).json({
                message:
                  'Platform error 2. Please check later or contact support',
              });
            }

            if (routeObject.handler.constructor.name !== 'AsyncFunction') {
              const error =
                "Handler should be AsyncFunction. Perhabs you miss 'async' of function declaration?";
              this.logger.error(error);
              return res.status(500).json({
                message:
                  'Platform error. Please check later or contact support',
              });
            }
            return routeObject.handler.call(this, req, res, next).catch((e) => {
              this.logger.error(e.message);
              // eslint-disable-next-line no-console
              console.error(e);
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

    const reports = {
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

    this.logger.verbose(text.join('\n'));

    /**
     * Generate documentation
     */
    if (!this.app.httpServer) {
      this.app.documentation.push(
        DocumentationGenerator.convertDataToDocumentationElement(
          this.getConstructorName(),
          routesInfo,
          middlewaresInfo,
          routeMiddlewaresReg,
        ),
      );
    } else {
      this.app.httpServer.express.use(expressPath, this.router);
    }
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
  get routes() {
    this.logger.warn('Please implement "routes" method on controller.');
    return {};
  }

  /**
   * Array of middlewares to append for route
   * You should provide path relative to controller and then array of middlewares to apply.
   * Order is matter.
   * Be default path apply to ANY' method, but you can preattach 'METHOD' into patch to scope patch to this METHOD
   * @example
   * return new Map([
   *    ['/*', [GetUserByToken]] // for any method for this controller
   *    ['POST/', [Auth]] // for POST method
   *    ['/superSecretMethod', [OnlySuperSecretUsers]] // route with ANY method
   *    ['PUT/superSecretMathod', [OnlySuperSecretAdmin]] // route with PUT method
   * ]);
   */
  static get middleware() {
    return new Map([['/*', [GetUserByToken, Auth]]]);
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
   * Get express path with inheritance of path
   */
  getExpressPath() {
    return `/${this.getConstructorName().toLowerCase()}`.replace('//', '/');
  }

  static get loggerGroup() {
    return 'controller';
  }
}

module.exports = AbstractController;
