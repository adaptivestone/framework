import type { Response } from 'express';
import AbstractController, {
  type TMiddleware,
} from '../modules/AbstractController.ts';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';

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

  // Home is public AND mounts at `/`, so any `/{*splat}` middleware here would
  // land on the route-tree root and run on EVERY request in the app. Override
  // the inherited default `[GetUserByToken, Auth]` with an empty Map: Home adds
  // no middleware and imposes nothing globally. (Re-add `[GetUserByToken]` if
  // you want a token-aware, personalized home.)
  static get middleware(): Map<string, TMiddleware> {
    return new Map();
  }
}

export default Home;
