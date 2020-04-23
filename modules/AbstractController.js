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
  constructor(app) {
    super(app);
    this.router = express.Router();
    const { routes } = this;
    const controllerName = this.constructor.name;
    // eslint-disable-next-line prefer-const
    for (let [path, middleware] of this.constructor.middleware) {
      if (!Array.isArray(middleware)) {
        middleware = [middleware];
      }
      for (const M of middleware) {
        this.router.use(path, new M(this.app).getMiddleware());
      }
    }

    for (const verb in routes) {
      if (this.router[verb]) {
        for (const path in routes[verb]) {
          let fn = routes[verb][path];
          if (typeof fn === 'string') {
            fn = this[fn];
          }
          if (typeof fn !== 'function') {
            this.logger.error(
              `Can't resolve function '${routes[verb][path]}' for controller '${controllerName}'`,
            );
            continue;
          }
          this.logger.verbose(
            `Controller '${controllerName}' register function '${routes[verb][path]}'  for method '${verb}' and path '${path}'`,
          );
          this.router[verb](path, fn.bind(this));
        }
      }
    }
    let path = '/';
    if (this.constructor.isUseControllerNameForRouting) {
      path = `/${controllerName.toLowerCase()}`;
    }
    this.app.httpServer.express.use(path, this.router);
    this.app.controllers[controllerName.toLowerCase()] = this;
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
        if ( Object.prototype.toString.call(validationResult) === '[object Array]'){
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
      if (!validationResult && ! errors[name]) {
        [,errors[name]] = rules[name];
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


  static get loggerGroup() {
    return 'controller';
  }
}

module.exports = AbstractController;
