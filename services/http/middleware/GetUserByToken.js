'use strict';

const AbstractMiddleware = require('./AbstractMiddleware');

class GetUserByToken extends AbstractMiddleware {
  async middleware(req, res, next) {
    let token = req.body.token;
    if (!token) {
      token = req.get('Authorization');
      if (!token || token === 'null') {
        //is null express bug*
        return next();
      }
    }
    let User = this.app.getModel('User');
    let user = await User.getUserByToken(token);
    if (user) {
      req.appInfo.user = user;
    }
    next();
  }
}

module.exports = GetUserByToken;
