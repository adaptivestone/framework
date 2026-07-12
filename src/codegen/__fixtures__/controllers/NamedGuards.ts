import type { Response } from 'express';
import AbstractController from '../../../modules/AbstractController.ts';
import { RoleGuard as Guard, NamedGuard } from '../middleware/Guards.ts';
import type { GetInfoRequest } from './NamedGuards.routes.gen.ts';

/**
 * Golden fixture for NAMED-export middleware imports (finding #6). `NamedGuard`
 * is imported by name and `RoleGuard` under the alias `Guard`; the gen file must
 * emit `import type { NamedGuard }` and `import type { RoleGuard as Guard }`.
 * Both a default-import form (a `TS2613`) and a wrong-type bind surface here: the
 * handler reads `req.appInfo.tenant` / `.role`, which only resolve when the named
 * imports bind to the right classes.
 */
class NamedGuards extends AbstractController {
  get routes() {
    return {
      get: { '/info': { handler: this.getInfo } },
    };
  }

  static get middleware() {
    return new Map([['/{*splat}', [NamedGuard, Guard]]]);
  }

  async getInfo(req: GetInfoRequest, res: Response) {
    const { tenant, role } = req.appInfo;
    return res.json({ tenant, role });
  }
}

export default NamedGuards;
