import AbstractMiddleware from './AbstractMiddleware.js';

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
      this.logger.info(
        `Finished ${text}. Status: ${res.statusCode}. Duration ${duration} ms`,
      );
    });
    next();
  }
}

export default RequestLogger;
