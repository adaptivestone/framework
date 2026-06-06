import type { Response } from 'express';
import AbstractController from '../../../modules/AbstractController.ts';
import { defineSchema } from '../../../services/validate/defineSchema.ts';
import type {
  GetItemRequest,
  PostCreateRequest,
} from './Schemas.routes.gen.ts';

/**
 * Golden fixture for the SCHEMA-OUTPUT and PARAMS typing paths — the parts the
 * `File` / `Inherited` fixtures don't exercise (they only check the
 * middleware-provided `user`). In one controller:
 *  - a `request:` schema → `req.appInfo.request` typed from the schema output.
 *  - a `query:` schema   → `req.appInfo.query`   typed from the schema output.
 *  - a `:id` path param  → `req.params.id`        typed as `string`.
 *
 * The assignments to explicitly-typed locals are the gate: if a route's
 * `request`/`query` type falls back to `Record<string, unknown>`, or `params.id`
 * is missing, these lines stop type-checking and the golden test fails.
 *
 * Uses the zero-dependency `defineSchema` (not yup) deliberately: the codegen
 * path is identical (it reads `StandardSchemaV1.InferOutput`), but defineSchema
 * type-checks cheaply and deterministically — yup's heavy inference would make
 * this `tsc`-gated test slow and load-sensitive, and yup is already covered
 * end-to-end by the framework's own yup-based controllers under `check:types`.
 */
class Schemas extends AbstractController {
  get routes() {
    return {
      post: {
        '/': {
          handler: this.postCreate,
          request: defineSchema<{ title: string; count: number }>((value) => {
            const v = (value ?? {}) as Record<string, unknown>;
            return {
              value: {
                title: String(v.title ?? ''),
                count: Number(v.count ?? 0),
              },
            };
          }),
        },
      },
      get: {
        '/:id': {
          handler: this.getItem,
          query: defineSchema<{ q: string }>((value) => {
            const v = (value ?? {}) as Record<string, unknown>;
            return { value: { q: String(v.q ?? '') } };
          }),
        },
      },
    };
  }

  async postCreate(req: PostCreateRequest, res: Response) {
    const title: string = req.appInfo.request.title;
    const count: number = req.appInfo.request.count;
    return res.json({ title, count });
  }

  async getItem(req: GetItemRequest, res: Response) {
    const id: string = req.params.id;
    const q: string = req.appInfo.query.q;
    return res.json({ id, q });
  }
}

export default Schemas;
