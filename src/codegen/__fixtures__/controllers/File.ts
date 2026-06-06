import type { Response } from 'express';
import AbstractController from '../../../modules/AbstractController.ts';
import Auth from '../../../services/http/middleware/Auth.ts';
import GetUserByToken from '../../../services/http/middleware/GetUserByToken.ts';
import type { PostUploadFileRequest } from './File.routes.gen.ts';

/**
 * Golden fixture exercising, in one controller:
 *  - a root (`/`) route under a non-root prefix (`/file`) → guards bug 1a
 *    (an empty middleware chain from the trailing-slash key mismatch).
 *  - the `Auth` middleware, default-exported as `AuthMiddleware` but imported
 *    under the binding `Auth` → guards bug 1b (binding vs class name).
 *  - reading `req.appInfo.user` with NO guard → guards bug 2 (`user` must be
 *    present AND non-optional behind `Auth`).
 *
 * The whole point is the `tsc` gate: if any of those regress, this file stops
 * type-checking.
 */
class File extends AbstractController {
  get routes() {
    return {
      post: { '/': { handler: this.postUploadFile } },
    };
  }

  static get middleware() {
    return new Map([['/{*splat}', [GetUserByToken, Auth]]]);
  }

  async postUploadFile(req: PostUploadFileRequest, res: Response) {
    const { user } = req.appInfo;
    return res.json({ id: user.id });
  }
}

export default File;
