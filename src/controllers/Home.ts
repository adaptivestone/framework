import type { Response } from 'express';
import AbstractController from '../modules/AbstractController.ts';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';
import GetUserByToken from '../services/http/middleware/GetUserByToken.ts';

class Home extends AbstractController {
  get routes() {
    return {
      get: {
        '/': this.home,
      },
    };
  }

  async home(_req: FrameworkRequest, res: Response) {
    return res.json({ message: 'Home' });
  }

  getHttpPath() {
    return '/';
  }

  static get middleware() {
    return new Map([['/{*splat}', [GetUserByToken]]]);
  }
}

export default Home;
