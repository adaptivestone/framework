const AbstractMiddleware = require('./AbstractMiddleware');

class RequestLogger extends AbstractMiddleware {
  static get description() {
    return 'Log info about the request';
  }

  async middleware(req, res, next) {
    const startTime = Date.now();
    const text = `Request is  [${req.method}] ${req.url}`;
    this.logger.info(text);
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      this.logger.info(`Finished ${text}. Duration ${duration} ms`);
    });
    next();
  }
}

module.exports = RequestLogger;
