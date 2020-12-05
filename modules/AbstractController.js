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
        const fullPath = `/${expressPath}/${path}`
          .split('//')
          .join('/')
          .split('//')
          .join('/');
        middlewaresInfo.push({
          name: M.name,
          method: 'ANY',
          path,
          fullPath,
        });

        this.router.use(path, new M(this.app).getMiddleware());
      }
    }

    const routesInfo = [];

    for (const verb in routes) {
      if (this.router[verb]) {
        for (const path in routes[verb]) {
          let fn = routes[verb][path];
          if (typeof fn === 'string') {
            fn = this[fn];
            this.logger.warn(
              'Using string as a controller callback deprecated. Please use function instead',
            );
          }
          if (typeof fn !== 'function') {
            this.logger.error(
              `Can't resolve function '${
                routes[verb][path]
              }' for controller '${this.getConstructorName()}'`,
            );
            continue;
          }

          let fnName = routes[verb][path];
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
            method: verb,
            path,
            fullPath,
          });
          // this.logger.verbose(
          //   `Controller '${this.getConstructorName()}' register function '${fnName}'  for method '${verb}' and path '${path}' Full path '${fullPath}'`,
          // );
          this.router[verb](path, fn.bind(this));
        }
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
          obj[name],
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
   * You should provide path and then array of middlewares to apply. Order is matter.
   * // TODO support for methods also
   */
  static get middleware() {
    return new Map([['/', [PrepareAppInfo, GetUserByToken, Auth]]]);
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
