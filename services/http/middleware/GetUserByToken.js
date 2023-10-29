const AbstractMiddleware = require('./AbstractMiddleware');

class GetUserByToken extends AbstractMiddleware {
  static get description() {
    return 'Grab a token and try to parse the user from it. It user exist will add req.appInfo.user variable';
  }

  get usedAuthParameters() {
    return [
      {
        name: 'Authorization',
        type: 'apiKey',
        in: 'header',
        description: this?.description,
      },
    ];
  }

  async middleware(req, res, next) {
    if (req.appInfo.user) {
      this.logger.warn('You call GetUserByToken more then once');
      return next();
    }
    let { token } = req.body;
    this.logger.verbose(
      `GetUserByToken token in BODY ${token}. Token in Authorization header ${req.get(
        'Authorization',
      )}`,
    );
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
