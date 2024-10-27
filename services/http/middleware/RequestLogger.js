import AbstractMiddleware from './AbstractMiddleware.js';

class RequestLogger extends AbstractMiddleware {
  static get description() {
    return 'Log info about the request';
  }

  async middleware(req, res, next) {
    const startTime = performance.now();
    const text = `Request is  [${req.method}] ${req.url}`;
    this.logger.info(text);
    res.on('finish', () => {
      const end = performance.now();
      this.logger.info(
        `Finished ${text}. Status: ${res.statusCode}.  [${(end - startTime).toFixed(2)} ms]`,
      );
    });
    next();
  }
}

export default RequestLogger;
