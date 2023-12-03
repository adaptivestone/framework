import AbstractMiddleware from './AbstractMiddleware.js';

class PrepareAppInfo extends AbstractMiddleware {
  static get description() {
    return 'Basic middleware that creates "req.appInfo" object';
  }

  async middleware(req, res, next) {
    if (!req.appInfo) {
      req.appInfo = {
        app: this.app,
      };
    }
    next();
  }
}

export default PrepareAppInfo;
