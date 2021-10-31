const Base = require('../../../modules/Base');

class AbstractMiddleware extends Base {
  static get description() {
    return ' Middleware description. Please provide own';
  }

  async middleware(req, res, next) {
    this.logger.warn('Middleware is not implemented');
    next();
  }

  getMiddleware() {
    return this.middleware.bind(this);
  }

  static get loggerGroup() {
    return 'middleware';
  }
}

module.exports = AbstractMiddleware;
