const yup = require('yup');
const AbstractController = require('../../modules/AbstractController');
const AuthMiddleware = require('../../services/http/middleware/Auth');
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
        '/postQueryParamaters': {
          handler: this.postQueryParamaters,
          request: yup.object().shape({
            name: yup.string(),
          }),
        },
        '/someDataItems': {
          handler: this.getSomeDataItems,
          request: yup.object().shape({
            items: yup.array().of(yup.string()),
            key: yup.string(),
          }),
        },
      },
      patch: {
        '/userAvatar': {
          handler: this.patchUserAvatar,
          request: yup.object().shape({
            avatar: yup.string(),
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
  async getSomething(req, res) {
    return res.status(200).json({ data: { text: 'Available text' } });
  }

  async getSomeDataItems(req, res) {
    const { items, key } = req.appInfo.request;

    await this.app.cache.getSetValue(key, () => items, 5);

    return res.status(200).json({ data: items });
  }

  // eslint-disable-next-line class-methods-use-this
  async postQueryParamaters(req, res) {
    const { name } = req.appInfo.request;
    return res.status(200).json({
      data: {
        name,
      },
    });
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
  async patchUserAvatar(req, res) {
    const { avatar } = req.appInfo.request;
    const { user } = req.appInfo;

    user.avatar = avatar;

    await user.save();

    return res.status(200).json({
      data: {
        updatedUser: user,
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

  static get middleware() {
    return new Map([
      ['/*', [GetUserByToken]],
      ['PATCH/userAvatar', [GetUserByToken, AuthMiddleware]],
      ['PUT/*', [[isAdmin, { roles: ['client'] }]]],
    ]);
  }
}

module.exports = SomeController;
