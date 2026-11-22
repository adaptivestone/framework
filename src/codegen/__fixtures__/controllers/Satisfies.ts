import type { Response } from 'express';
import AbstractController, {
  type RouteParams,
} from '../../../modules/AbstractController.ts';
import { defineSchema } from '../../../services/validate/defineSchema.ts';
import type { PostCreateRequest } from './Satisfies.routes.gen.ts';

/**
 * Golden fixture for `satisfies RouteParams` on the returned routes object: the
 * getter keeps its literal type, so generated request types can navigate into
 * it. A `get routes(): RouteParams` annotation would widen it, and the gen file
 * would fail with TS2339 (codegen warns about that).
 */
class Satisfies extends AbstractController {
  get routes() {
    return {
      post: {
        '/': {
          handler: this.postCreate,
          request: defineSchema<{ title: string }>((value) => {
            const v = (value ?? {}) as Record<string, unknown>;
            return { value: { title: String(v.title ?? '') } };
          }),
        },
      },
    } satisfies RouteParams;
  }

  async postCreate(req: PostCreateRequest, res: Response) {
    const title: string = req.appInfo.request.title;
    // @ts-expect-error the schema output is a precise `string`, not `any`
    const count: number = req.appInfo.request.title;
    return res.json({ title, count });
  }
}

export default Satisfies;
