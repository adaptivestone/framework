const yup = require('yup');
const AbstractController = require('../../modules/AbstractController');
const AuthMiddleware = require('../../services/http/middleware/Auth');
const GetUserByToken = require('../../services/http/middleware/GetUserByToken');
const RateLimiter = require('../../services/http/middleware/RateLimiter');
const CheckFlag = require('../../services/http/middleware/test/CheckFlag');
const RoleMiddleware = require('../../services/http/middleware/Role');
const Pagination = require('../../services/http/middleware/Pagination');

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
          middleware: [RateLimiter, [RoleMiddleware, { roles: ['admin'] }]],
        },
        '/grabSomeDataFromQuery': {
          handler: this.grabSomeDataFromQuery,
          query: yup.object().shape({
            name: yup.string(),
          }),
        },
        '/grabSomeDataFromQueryWithRequiredParam': {
          handler: this.grabSomeDataFromQuery,
          query: yup.object().shape({
            name: yup.number().required(),
          }),
        },
        '/grabSomeDataFromQueryWithMiddlewareParams': {
          handler: this.grabSomeDataFromQueryWithMiddlewareParams,
          query: yup.object().shape({
            name: yup.string(),
          }),
          middleware: [Pagination],
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
          }),
          middleware: [[RoleMiddleware, { roles: ['admin'] }]],
        },
      },
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async getSomething(req, res) {
    return res.status(200).json({ data: { text: 'Available text' } });
  }

  // eslint-disable-next-line class-methods-use-this
  async grabSomeDataFromQuery(req, res) {
    return res.status(200).json({ data: { name: req.appInfo.query.name } });
  }

  // eslint-disable-next-line class-methods-use-this
  async grabSomeDataFromQueryWithMiddlewareParams(req, res) {
    const { page, limit, name } = req.appInfo.query;
    return res.status(200).json({ data: { page, limit, name } });
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
      ['PUT/*', [[RoleMiddleware, { roles: ['client'] }]]],
    ]);
  }
}

module.exports = SomeController;
