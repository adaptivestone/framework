const AbstractMiddleware = require('./AbstractMiddleware');

class AuthMiddleware extends AbstractMiddleware {
  static get description() {
    return 'Allow to pass only if user provided. Please use any middleware that provide user instance before';
  }

  async middleware(req, res, next) {
    if (!req.appInfo.user) {
      this.logger.info('User try to access resource without credentials');
      return res.status(401).json({
        error: 'AUTH001',
        message: 'Please login to application',
      });
    }
    return next();
  }
}

module.exports = AuthMiddleware;
