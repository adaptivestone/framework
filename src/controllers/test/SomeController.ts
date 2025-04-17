import { object, boolean, string, number } from 'yup';
import AbstractController from '../../modules/AbstractController.ts';
import AuthMiddleware from '../../services/http/middleware/Auth.js';
import GetUserByToken from '../../services/http/middleware/GetUserByToken.ts';
import RateLimiter from '../../services/http/middleware/RateLimiter.js';
import CheckFlag from '../../services/http/middleware/test/CheckFlag.ts';
import RoleMiddleware from '../../services/http/middleware/Role.js';
import Pagination from '../../services/http/middleware/Pagination.js';

import type { Response } from 'express';
import type { FrameworkRequest } from '../../services/http/HttpServer.ts';
import type {
  TMiddleware,
  RouteParams,
} from '../../modules/AbstractController.ts';

class SomeController extends AbstractController {
  get routes(): RouteParams {
    return {
      get: {
        '/': {
          handler: this.getSomething,
          middleware: [RateLimiter],
        },
        '/someData': {
          handler: this.getSomething,
          query: object().shape({
            flag: boolean().required(),
          }),
          middleware: [RateLimiter, CheckFlag],
        },
        '/someDataWithPermission': {
          handler: this.getSomething,
          middleware: [RateLimiter, [RoleMiddleware, { roles: ['admin'] }]],
        },
        '/grabSomeDataFromQuery': {
          handler: this.grabSomeDataFromQuery,
          query: object().shape({
            name: string(),
          }),
        },
        '/grabSomeDataFromQueryWithRequiredParam': {
          handler: this.grabSomeDataFromQuery,
          query: object().shape({
            name: number().required(),
          }),
        },
        '/grabSomeDataFromQueryWithMiddlewareParams': {
          handler: this.grabSomeDataFromQueryWithMiddlewareParams,
          query: object().shape({
            name: string(),
          }),
          middleware: [Pagination],
        },
      },
      post: {
        '/postInfo': {
          handler: this.addPost,
          request: object().shape({
            name: string(),
            discription: string(),
          }),
        },
        '/postQueryParamaters': {
          handler: this.postQueryParamaters,
          request: object().shape({
            name: string(),
          }),
        },
      },
      patch: {
        '/userAvatar': {
          handler: this.patchUserAvatar,
          request: object().shape({
            avatar: string(),
          }),
        },
      },
      put: {
        // '/putInfo': {
        //   handler: this.putInfo,
        //   request: object().shape({
        //     field: string(),
        //   }),
        //   middleware: [[RoleMiddleware, { roles: ['admin'] }]],
        // },
      },
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async getSomething(req: FrameworkRequest, res: Response) {
    return res.status(200).json({ data: { text: 'Available text' } });
  }

  // eslint-disable-next-line class-methods-use-this
  async grabSomeDataFromQuery(req: FrameworkRequest, res: Response) {
    return res.status(200).json({ data: { name: req.appInfo.query.name } });
  }

  // eslint-disable-next-line class-methods-use-this
  async grabSomeDataFromQueryWithMiddlewareParams(
    req: FrameworkRequest,
    res: Response,
  ) {
    const { page, limit, name } = req.appInfo.query;
    return res.status(200).json({ data: { page, limit, name } });
  }

  // eslint-disable-next-line class-methods-use-this
  async postQueryParamaters(req: FrameworkRequest, res: Response) {
    const { name } = req.appInfo.request;
    return res.status(200).json({
      data: {
        name,
      },
    });
  }

  // eslint-disable-next-line class-methods-use-this
  async addPost(req: FrameworkRequest, res: Response) {
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
  async patchUserAvatar(req: FrameworkRequest, res: Response) {
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
  async putInfo(req: FrameworkRequest, res: Response) {
    const { field } = req.appInfo.request;

    return res.status(200).json({
      data: {
        newField: {
          field,
        },
      },
    });
  }

  static get middleware(): Map<string, TMiddleware> {
    return new Map([
      ['/{*splat}', [GetUserByToken]],
      ['PATCH/userAvatar', [GetUserByToken, AuthMiddleware]],
      ['PUT/{*splat}', [[RoleMiddleware, { roles: ['client'] }]]],
    ]);
  }
}

export default SomeController;
