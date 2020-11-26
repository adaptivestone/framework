const AbstractMiddleware = require('./AbstractMiddleware');

class AuthMiddleware extends AbstractMiddleware {
  async middleware(req, res, next) {
    if (!req.appInfo.user) {
      this.logger.info('User try to access resource withou credentials');
      return res.status(401).json({
        error: 'AUTH001',
        message: 'Please login to application',
      });
    }
    return next();
  }
}

module.exports = AuthMiddleware;
