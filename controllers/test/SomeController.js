const yup = require('yup');
const AbstractController = require('../../modules/AbstractController');
const GetUserByToken = require('../../services/http/middleware/GetUserByToken');
const RateLimiter = require('../../services/http/middleware/RateLimiter');
const CheckFlag = require('../../services/http/middleware/test/CheckFlag');
const isAdmin = require('../../services/http/middleware/test/isAdmin');

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
      post: {
        '/postInfo': {
          handler: this.addPost,
          request: yup.object().shape({
            name: yup.string(),
            discription: yup.string(),
          }),
        },
      },
      put: {
        '/putInfo': {
          handler: this.putInfo,
          request: yup.object().shape({
            field: yup.string(),
            user: yup.object().shape({
              role: yup.string().oneOf(['client', 'admin']).required(),
            }),
          }),
          middleware: [[isAdmin, { roles: ['admin'] }]],
        },
      },
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async addPost(req, res) {
    const { name, discription } = req.appInfo.request;

    return res.status(200).json({
      data: {
        newPost: {
          name,
          discription,
        },
      },
    });
  }

  // eslint-disable-next-line class-methods-use-this
  async putInfo(req, res) {
    const { field } = req.appInfo.request;

    return res.status(200).json({
      data: {
        newField: {
          field,
        },
      },
    });
  }

  // eslint-disable-next-line class-methods-use-this
  async getSomething(req, res) {
    return res.status(200).json({ data: { text: 'Available text' } });
  }

  static get middleware() {
    return new Map([
      ['/*', [GetUserByToken]],
      ['PUT/*', [[isAdmin, { roles: ['client'] }]]],
    ]);
  }
}

module.exports = SomeController;
