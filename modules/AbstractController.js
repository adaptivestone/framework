/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
const express = require('express');
const validator = require('validator');

const Base = require('./Base');
const PrepareAppInfo = require('../services/http/middleware/PrepareAppInfo');
const GetUserByToken = require('../services/http/middleware/GetUserByToken');
const Auth = require('../services/http/middleware/Auth');


class AbstractController extends Base {
  constructor(app) {
    super(app);
    this.router = express.Router();
    const {routes} = this;
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
  }

  validate(obj, rules) {
    const errors = {};
    for (const name in rules) {
      let validationResult = false;
      if (typeof rules[name][0] === 'function') {
        validationResult = rules[name][0](obj[name]);
      } else if (typeof validator[rules[name][0]] === 'function') {
        // use from validator then
        validationResult = validator[rules[name][0]](obj[name]);
      } else {
        this.logger.warn(
          `No rule found for ${name}. Swith to existing checking`,
        );
        validationResult = !!obj[name];
      }
      if (!validationResult) {
        errors[name] = rules[name][1];
      }
    }
    if (Object.entries(errors).length === 0 && errors.constructor === Object) {
      return false;
    }
    return errors;
  }

  static get loggerGroup() {
    return 'controller';
  }

  static get middleware() {
    return new Map([['/', [PrepareAppInfo, GetUserByToken, Auth]]]);
  }

  static get isUseControllerNameForRouting() {
    return true;
  }
}

module.exports = AbstractController;
