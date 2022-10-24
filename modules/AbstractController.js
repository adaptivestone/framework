/* eslint-disable array-callback-return */
/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
const express = require('express');
const merge = require('deepmerge');

const Base = require('./Base');
const GetUserByToken = require('../services/http/middleware/GetUserByToken');
const Auth = require('../services/http/middleware/Auth');

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
            authParams: MiddlewareFunction?.usedAuthParameters,
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
        const { controllerValidationAbortEarly } =
          this.app.getConfig('validate');
        this.router[verb](
          path,
          additionalMiddlewares || [],
          async (req, res, next) => {
            if (routeObject.request) {
              if (typeof routeObject.request.validate !== 'function') {
                this.logger.error('request.validate should be a function');
              }
              if (typeof routeObject.request.cast !== 'function') {
                this.logger.error('request.cast should be a function');
              }
              const bodyAndQuery = merge(req.query, req.body);

              try {
                await routeObject.request.validate(bodyAndQuery, {
                  abortEarly: controllerValidationAbortEarly,
                });
              } catch (e) {
                let { errors } = e;
                // translate it
                if (req.i18n && errors) {
                  errors = errors.map((err) => req.i18n.t(err));
                }
                this.logger.error(
                  `Request validation failed with message: ${e.message}. errors: ${errors}`,
                );

                const errorAnswer = {};
                if (!e.inner.length) {
                  errorAnswer[e.path] = errors;
                } else {
                  e.inner.forEach((err) => {
                    errorAnswer[err.path] = err.errors;
                    if (req.i18n && err.errors) {
                      errorAnswer[err.path] = err.errors.map((err1) =>
                        req.i18n.t(err1),
                      );
                    }
                  });
                }

                return res.status(400).json({
                  errors: errorAnswer,
                });
              }
              req.appInfo.request = await routeObject.request.cast(
                bodyAndQuery,
                {
                  stripUnknown: true,
                },
              );
            }
            req.body = new Proxy(req.body, {
              get: (target, prop) => {
                this.logger.warn(
                  'Please not use "req.body" directly. Implement "request" and use "req.appInfo.request" ',
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

    const processingFields = (fieldsByRoute) => {
      const fields = [];
      if (!fieldsByRoute) {
        return fields;
      }
      const entries = Object.entries(fieldsByRoute);
      entries.forEach(([key, value]) => {
        const field = {};
        field.name = key;
        field.type = value.type;
        if (value.exclusiveTests) {
          field.isRequired = value.exclusiveTests.required;
        }
        if (value?.innerType) {
          field.innerType = value?.innerType?.type;
        }

        if (value.fields) {
          field.fields = [];
          // eslint-disable-next-line no-shadow
          const entries = Object.entries(value.fields);
          // eslint-disable-next-line no-shadow
          entries.forEach(([key, value]) => {
            field.fields.push({
              name: key,
              type: value.type,
            });
          });
        }
        fields.push(field);
      });
      return fields;
    };

    if (!this.app.httpServer) {
      this.app.documentation.push({
        contollerName: this.getConstructorName(),
        routesInfo: routesInfo.map((route) => ({
          [route.fullPath]: {
            method: route.method,
            name: route.name,
            description: route?.description,
            fields: processingFields(route.fields),
            routeMiddlewares: routeMiddlewaresReg
              // eslint-disable-next-line consistent-return
              .map((middleware) => {
                if (
                  route.fullPath.toUpperCase() ===
                    middleware.fullPath.toUpperCase() ||
                  middleware.fullPath.toUpperCase() ===
                    `${route.fullPath.toUpperCase()}*`
                ) {
                  return {
                    name: middleware.name,
                    params: middleware.params,
                    authParams: middleware.authParams,
                  };
                }
              })
              .filter(Boolean),
            controllerMiddlewares: [
              ...new Set(
                middlewaresInfo
                  .filter(
                    (middleware) =>
                      middleware.fullPath.toUpperCase() ===
                        route.fullPath.toUpperCase() ||
                      middleware.fullPath.toUpperCase() ===
                        `${route.fullPath.toUpperCase()}*`,
                  )
                  .map(({ name, params, authParams }) => ({
                    name,
                    params,
                    authParams,
                  })),
              ),
            ],
          },
        })),
      });
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
