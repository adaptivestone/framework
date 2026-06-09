import type { Response } from 'express';
import AbstractController from '../../../modules/AbstractController.ts';
import RateLimiter from '../../../services/http/middleware/RateLimiter.ts';
import { defineSchema } from '../../../services/validate/defineSchema.ts';
import type {
  GetThingRequest,
  PostUploadRequest,
} from './Advanced.routes.gen.ts';

/**
 * Golden fixture for the AST front-end's two extra static paths (the ones that
 * used to force a boot fallback):
 *  - a **content-type request map** (`request: { 'application/json': … }`) → the
 *    discriminated `req.appInfo.request` union;
 *  - **route-level `middleware`** that adds a binding not in the inherited chain
 *    (`RateLimiter`, on top of `AbstractController`'s `[GetUserByToken, Auth]`).
 */
class Advanced extends AbstractController {
  get routes() {
    return {
      post: {
        '/upload': {
          handler: this.postUpload,
          request: {
            'application/json': defineSchema<{ name: string }>((value) => {
              const v = (value ?? {}) as Record<string, unknown>;
              return { value: { name: String(v.name ?? '') } };
            }),
            'multipart/form-data': defineSchema<{ name: string }>((value) => {
              const v = (value ?? {}) as Record<string, unknown>;
              return { value: { name: String(v.name ?? '') } };
            }),
          },
        },
      },
      get: {
        '/thing': { handler: this.getThing, middleware: [RateLimiter] },
      },
    };
  }

  async postUpload(req: PostUploadRequest, res: Response) {
    void req.appInfo.request;
    return res.json({ ok: true });
  }

  async getThing(req: GetThingRequest, res: Response) {
    void req.appInfo.user;
    return res.json({ ok: true });
  }
}

export default Advanced;
