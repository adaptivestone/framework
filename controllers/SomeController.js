const AbstractController = require('../modules/AbstractController');
const PrepareAppInfo = require('../services/http/middleware/PrepareAppInfo');
const GetUserByToken = require('../services/http/middleware/GetUserByToken');
const RateLimiter = require('../services/http/middleware/RateLimiter');

class SomeController extends AbstractController {
  get routes() {
    return {
      get: {
        '/': {
          handler: this.getSomething,
          middleware: [RateLimiter],
        },
      },
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async getSomething(req, res) {
    return res.status(200).json({ data: { text: 'Available text' } });
  }

  static get middleware() {
    return new Map([['/*', [PrepareAppInfo, GetUserByToken]]]);
  }
}

module.exports = SomeController;
