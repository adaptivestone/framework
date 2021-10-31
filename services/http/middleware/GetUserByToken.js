const AbstractMiddleware = require('./AbstractMiddleware');

class GetUserByToken extends AbstractMiddleware {
  static get description() {
    return 'Grab token and try to parsse user from it. It user exist will add req.appInfo.user variable';
  }

  async middleware(req, res, next) {
    let { token } = req.body;
    if (!token) {
      token = req.get('Authorization');
      if (!token || token === 'null') {
        // is null express bug*
        return next();
      }
    }
    const User = this.app.getModel('User');
    const user = await User.getUserByToken(token);
    if (user) {
      req.appInfo.user = user;
    }
    return next();
  }
}

module.exports = GetUserByToken;
