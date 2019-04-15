"use strict";

const AbstractMiddleware = require("./AbstractMiddleware");

class GetUserByToken extends AbstractMiddleware {
    async middleware(req, res, next) {
        if (!req.appInfo) {
            req.appInfo = {
                app:this.app
            };
        }
        next();
    }

}

module.exports = GetUserByToken;