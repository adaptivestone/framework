"use strict";
const express = require('express');
const Base = require('./Base');
const PrepareAppInfo  = require('../services/http/middleware/PrepareAppInfo');
const GetUserByToken  = require('../services/http/middleware/GetUserByToken');
const Auth  = require('../services/http/middleware/Auth');

class AbstractController extends Base{
    constructor(app) {
        super(app);
        this.router = express.Router();
        let routes = this.routes;
        let controllerName = this.constructor.name;
        for (let [path,middleware] of this.constructor.middleware){
            if (!Array.isArray(middleware)){
                middleware = [middleware];
            }
            for (let m of middleware){
                this.router.use(path,new m(this.app).getMiddleware());
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
                        this.logger.error(`Can't resolve function '${routes[verb][path]}' for controller '${controllerName}'`);
                        continue;
                    }
                    this.logger.verbose(`Controller '${controllerName}' register function '${routes[verb][path]}'  for method '${verb}' and path '${path}'`);
                    this.router[verb](path,fn.bind(this));
                }

            }


        }
        let path = '/';
        if (this.constructor.isUseControllerNameForRouting){
            path = "/"+controllerName.toLowerCase();
        }
        this.app.httpServer.express.use(path, this.router);
        this.app.controllers[controllerName.toLowerCase()] = this;
    }
    static get loggerGroup(){
        return 'controller'
    }
    static get middleware(){
        return new Map([[
            "/",[PrepareAppInfo,GetUserByToken,Auth]
        ]]);
    }


    static get isUseControllerNameForRouting(){
        return true;
    };

}

module.exports = AbstractController;