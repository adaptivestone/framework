import type { Response } from 'express';
import AbstractController from '../../../modules/AbstractController.ts';
import type { GetInheritedRequest } from './Inherited.routes.gen.ts';

/**
 * Golden fixture for INHERITED default middleware. This controller declares NO
 * `static get middleware()` of its own — it relies on `AbstractController`'s
 * default `[GetUserByToken, Auth]`. Codegen must walk the `extends` chain,
 * resolve the inherited middleware, and narrow `req.appInfo.user` accordingly.
 * Guards the regression where an inheriting controller emitted an empty chain.
 *
 * (The bare-package-ancestor variant of this — a consumer extending the
 * framework from `node_modules` — is unit-tested in `emit.test.ts`, since it
 * can't be exercised end-to-end inside this repo.)
 */
class Inherited extends AbstractController {
  get routes() {
    return {
      get: { '/': { handler: this.getInherited } },
    };
  }

  async getInherited(req: GetInheritedRequest, res: Response) {
    const { user } = req.appInfo;
    return res.json({ id: user.id });
  }
}

export default Inherited;
