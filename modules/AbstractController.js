'use strict';
const express = require('express');
const Base = require('./Base');
const PrepareAppInfo = require('../services/http/middleware/PrepareAppInfo');
const GetUserByToken = require('../services/http/middleware/GetUserByToken');
const Auth = require('../services/http/middleware/Auth');

const validator = require('validator');

class AbstractController extends Base {
  constructor(app) {
    super(app);
    this.router = express.Router();
    let routes = this.routes;
    let controllerName = this.constructor.name;
    for (let [path, middleware] of this.constructor.middleware) {
      if (!Array.isArray(middleware)) {
        middleware = [middleware];
      }
      for (let m of middleware) {
        this.router.use(path, new m(this.app).getMiddleware());
      }
    }

    for (let verb in routes) {
      if (this.router[verb]) {
        for (let path in routes[verb]) {
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
      path = '/' + controllerName.toLowerCase();
    }
    this.app.httpServer.express.use(path, this.router);
    this.app.controllers[controllerName.toLowerCase()] = this;
  }

  validate(obj, rules) {
    let errors = {};
    for (let name in rules) {
      let validationResult = false;
      if (typeof rules[name][0] === 'function') {
        validationResult = rules[name][0](obj[name]);
      } else if (typeof validator[rules[name][0]] === 'function') {
        //use from validator then
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
