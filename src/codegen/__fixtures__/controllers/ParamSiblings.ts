import type { Response } from 'express';
import AbstractController from '../../../modules/AbstractController.ts';
import type {
  DuplicateRequest,
  UpdateRequest,
  YachtsRequest,
} from './ParamSiblings.routes.gen.ts';

/**
 * Golden fixture for the PARAM-SIBLING NAME COLLISION bug. Two sibling routes at
 * the same trie depth use param segments with DIFFERENT names (`/:slug` vs
 * `/:event`). The router collapses them onto a single param trie node named by
 * the first-registered segment (`:slug`), so `flatten()` reconstructs every
 * sibling's path with `:slug` — while codegen looks up each route's middleware
 * chain by its SOURCE path (`:event`). That mismatch used to miss the lookup and
 * emit an empty `UnionAppInfoProvides<readonly []>` for the `:event` siblings,
 * even though at runtime they DO run the controller's `[GetUserByToken, Auth]`.
 *
 * Declares NO `static get middleware()` — it inherits `AbstractController`'s
 * default `[GetUserByToken, Auth]`, matching the reported scenario.
 *
 * The gate: `update` / `yachts` read `req.appInfo.user` with NO guard. If their
 * chain regresses to empty, `user` drops from the type and this file stops
 * type-checking. Params come from AST source, so `{ slug }` / `{ event }` must
 * survive too.
 */
class ParamSiblings extends AbstractController {
  get routes() {
    return {
      put: { '/:slug': { handler: this.duplicate } },
      post: { '/:event': { handler: this.update } },
      get: { '/:event/get-yachts': { handler: this.yachts } },
    };
  }

  async duplicate(req: DuplicateRequest, res: Response) {
    const { user } = req.appInfo;
    return res.json({ id: user.id, slug: req.params.slug });
  }

  async update(req: UpdateRequest, res: Response) {
    const { user } = req.appInfo;
    return res.json({ id: user.id, event: req.params.event });
  }

  async yachts(req: YachtsRequest, res: Response) {
    const { user } = req.appInfo;
    return res.json({ id: user.id, event: req.params.event });
  }
}

export default ParamSiblings;
