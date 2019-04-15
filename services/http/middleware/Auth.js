"use strict";

const AbstractMiddleware = require("./AbstractMiddleware");

class AuthMiddleware extends AbstractMiddleware {
    async middleware(req, res, next) {
        if (!req.appInfo.user){
            return res.status(401).json({
                error: "AUTH001",
                message: "Please login to application"
            });
        }
        next();
    }
}

module.exports = AuthMiddleware;