const yup = require('yup');
const AbstractController = require('../modules/AbstractController');
const PrepareAppInfo = require('../services/http/middleware/PrepareAppInfo');
const GetUserByToken = require('../services/http/middleware/GetUserByToken');
const RateLimiter = require('../services/http/middleware/RateLimiter');
const CheckFlag = require('./test/middlewares/CheckFlag');
const isAdmin = require('./test/middlewares/isAdmin');

class SomeController extends AbstractController {
  get routes() {
    return {
      get: {
        '/': {
          handler: this.getSomething,
          middleware: [RateLimiter],
        },
        '/someData': {
          handler: this.getSomething,
          request: yup.object().shape({
            flag: yup.boolean().required(),
          }),
          middleware: [RateLimiter, CheckFlag],
        },
        '/someDataWithPermission': {
          handler: this.getSomething,
          request: yup.object().shape({
            user: yup.object().shape({
              role: yup.string().oneOf(['client', 'admin']).required(),
            }),
          }),
          middleware: [RateLimiter, [isAdmin, { roles: ['admin'] }]],
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
