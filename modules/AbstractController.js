/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
const express = require('express');
const validator = require('validator');

const Base = require('./Base');
const PrepareAppInfo = require('../services/http/middleware/PrepareAppInfo');
const GetUserByToken = require('../services/http/middleware/GetUserByToken');
const Auth = require('../services/http/middleware/Auth');

/**
 * Abstract controller. You shoul extend any controller from them.
 * Place you cintroller into controller folder and it be inited in auto way.
 * By default name of route will be controller name not file name. But please name it in same ways.
 * You can overwrite base controllers byt creating controllers with tha same file name (yes file name, not class name)
 * In most cases you will want to have a 'home' route that not include controller name. For this case please check 'isUseControllerNameForRouting'
 */
class AbstractController extends Base {
  constructor(app, prefix) {
    const time = Date.now();
    super(app);
    this.prefix = prefix;
    this.router = express.Router();
    const { routes } = this;

    const expressPath = this.getExpressPath();

    const middlewaresInfo = [];

    // eslint-disable-next-line prefer-const
    for (let [path, middleware] of this.constructor.middleware) {
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
        middlewaresInfo.push({
          name: M.name,
          method: method.toUpperCase(),
          path: realPath,
          fullPath,
        });

        this.router[method](realPath, new M(this.app).getMiddleware());
      }
    }

    const routesInfo = [];

    for (const verb in routes) {
      if (typeof this.router[verb] !== 'function') {
        this.logger.error(
          `Method ${verb} not exist for router. Please check your codebase`,
        );
        // eslint-disable-next-line no-continue
        continue;
      }
      for (const path in routes[verb]) {
        let routeObject = routes[verb][path];
        if (Object.prototype.toString.call(routeObject) !== '[object Object]') {
          routeObject = {
            handler: routeObject,
            request: null,
          };

          if (typeof routeObject.handler === 'string') {
            routeObject.handler = this[routeObject];
            this.logger.warn(
              'Using string as a controller callback deprecated. Please use function instead',
            );
          }

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
          method: verb.toUpperCase(),
          path,
          fullPath,
        });
        // this.logger.verbose(
        //   `Controller '${this.getConstructorName()}' register function '${fnName}'  for method '${verb}' and path '${path}' Full path '${fullPath}'`,
        // );

        this.router[verb](path, async (req, res, next) => {
          if (routeObject.request) {
            if (typeof routeObject.request.validate !== 'function') {
              this.logger.error('request.validate should be a function');
            }
            if (typeof routeObject.request.cast !== 'function') {
              this.logger.error('request.cast should be a function');
            }

            try {
              await routeObject.request.validate(req.body);
            } catch (e) {
              this.logger.error(`Request validation failed: ${e.errors}`);

              return res.status(400).json({
                errors: {
                  [e.path]: e.errors,
                },
              });
            }
            req.appInfo.request = routeObject.request.cast(req.body, {
              stripUnknown: true,
            });
          }
          // todo check for promise
          return routeObject.handler.call(this, req, res, next).catch((e) => {
            this.logger.error(e.message);
            console.error(e);
            return res.status(500).json({
              succes: false,
              message: 'Platform error. Please check later or contact support',
            });
          });
        });
      }
    }

    const text = [
      '',
      `Controller '${this.getConstructorName()}' registered.`,
      'Middlewares:',
    ];

    middlewaresInfo.forEach((m) => {
      text.push(
        `Path:'${m.path}'. Full path: '${m.fullPath}'. Method: '${m.method}'. Function: '${m.name}'`,
      );
    });
    text.push('Callbacks:');

    routesInfo.forEach((m) => {
      text.push(
        `Path:'${m.path}'. Full path: '${m.fullPath}'. Method: '${m.method}'. Callback: '${m.name}'`,
      );
    });
    text.push(`Time: ${Date.now() - time} ms`);

    this.logger.verbose(text.join('\n'));

    this.app.httpServer.express.use(expressPath, this.router);
  }

  /**
   * Internal validation method for params validation.
   * You can pass own function or use validator.js functions
   * From own function you can return a bool then will be treater as rule pass or not. At that case error message will be used from default error. But you also can provide error as output. Where only one arrya element will be an error message
   * @param {object} obj object with params to validate
   * @param {object} rules validation rules. rule name should match parameter name
   * @example
   * // We can pass own function
   * validate({
   *      someKey:10
   *    },{
   *      'someKey':[
   *        (val)=>val>10,
   *        'Error message'
   *      ]
   *    })
   * @example
   * // We can pass function to validator.js
   *  validate({
   *      someKey: 'test_at_test.com'
   *    },{
   *      'someKey':[
   *        'isEmail',
   *        'Please provide valid email'
   *      ]
   *    })
   * @example
   * // We can pass function to validator.js with params
   *  validate({
   *      someKey: 'test_at_test.com'
   *    },{
   *      'someKey':[
   *        ['isEmail',{'require_tld':false}],
   *        'Please provide valid email'
   *      ]
   *    })
   */
  validate(obj, rules) {
    const errors = {};
    for (const name in rules) {
      let validationResult = false;
      if (typeof rules[name][0] === 'function') {
        validationResult = rules[name][0](obj[name]);
        if (
          Object.prototype.toString.call(validationResult) === '[object Array]'
        ) {
          [errors[name]] = validationResult;
          validationResult = false;
        }
      } else if (typeof validator[rules[name][0]] === 'function') {
        // use from validator then
        validationResult = validator[rules[name][0]](obj[name]);
      } else if (
        Object.prototype.toString.call(rules[name][0]) === '[object Array]' &&
        typeof validator[rules[name][0][0]] === 'function'
      ) {
        // use from validator then
        validationResult = validator[rules[name][0][0]](
          `${obj[name]}`,
          rules[name][0][1],
        );
      } else {
        this.logger.warn(
          `No rule found for ${name}. Swith to existing checking`,
        );
        validationResult = !!obj[name];
      }
      if (!validationResult && !errors[name]) {
        [, errors[name]] = rules[name];
      }
    }
    if (Object.entries(errors).length === 0 && errors.constructor === Object) {
      return false;
    }
    return errors;
  }

  /**
   * Array of middlewares to append for route
   * You should provide path relative to controller and then array of middlewares to apply.
   * Order is matter.
   * Be default path apply to ANY' method, but you can preattach 'METHOD' into patch to scope patch to this METHOD
   * @example
   * return new Map([
   *    ['/*', [PrepareAppInfo, GetUserByToken]] // for any method for this controller
   *    ['POST/', [Auth]] // for POST method
   *    ['/superSecretMethod', [OnlySuperSecretUsers]] // route with ANY method
   *    ['PUT/superSecretMathod', [OnlySuperSecretAdmin]] // route with PUT method
   * ]);
   */
  static get middleware() {
    return new Map([['/*', [PrepareAppInfo, GetUserByToken, Auth]]]);
  }

  /**
   * Part of abstract contorller.
   * When you do not need controller name to append in route then return false here.
   * Useful for home(root) controllers
   */
  static get isUseControllerNameForRouting() {
    return true;
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
    if (!this.constructor.isUseControllerNameForRouting) {
      return '/';
    }
    return `/${this.getConstructorName().toLowerCase()}`.replace('//', '/');
  }

  static get loggerGroup() {
    return 'controller';
  }
}

module.exports = AbstractController;
