import type { Response } from 'express';
import AbstractController, {
  type TMiddleware,
} from '../modules/AbstractController.ts';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';
import { HttpResponse, type JsonResponse } from '../services/http/responses.ts';

class Home extends AbstractController {
  get routes() {
    return {
      get: {
        '/': this.home,
      },
    };
  }

  // `res` stays in the signature (and `Response` in the return type) so an
  // override written against the previous `res.json(...)` version still fits.
  async home(
    _req: FrameworkRequest,
    _res?: Response,
  ): Promise<JsonResponse<200, { message: string }> | Response> {
    return HttpResponse.json(200, { message: 'Home' });
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
