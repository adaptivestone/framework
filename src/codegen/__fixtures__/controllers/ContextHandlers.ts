import AbstractController from '../../../modules/AbstractController.ts';
import { HttpResponse } from '../../../services/http/responses.ts';
import { defineSchema } from '../../../services/validate/defineSchema.ts';
import type {
  CreateContext,
  ShowContext,
} from './ContextHandlers.routes.gen.ts';

/**
 * Golden fixture for v2 handlers (`static contractVersion = 2`): each handler
 * takes the generated `<MethodName>Context` and reads the same validated
 * input and middleware-provided `appInfo` a 5.x handler reads from `req`.
 */
class ContextHandlers extends AbstractController {
  static get contractVersion() {
    return 2 as const;
  }

  get routes() {
    return {
      post: {
        '/:slug': {
          handler: this.create,
          request: defineSchema<{ title: string }>((value) => {
            const v = (value ?? {}) as Record<string, unknown>;
            return { value: { title: String(v.title ?? '') } };
          }),
        },
      },
      get: {
        '/:slug/show': this.show,
      },
    };
  }

  async create(ctx: CreateContext) {
    const title: string = ctx.appInfo.request.title;
    const slug: string = ctx.params.slug;
    // Behind the inherited `[GetUserByToken, Auth]`: present, no guard.
    const user: object = ctx.appInfo.user;
    void user;
    return HttpResponse.json(201, { title, slug });
  }

  async show(ctx: ShowContext) {
    // @ts-expect-error — the context is read-only; staging goes through `ctx.response`.
    ctx.params = {};
    ctx.response.setHeader('cache-control', 'no-store');
    return HttpResponse.json(200, { slug: ctx.params.slug });
  }
}

export default ContextHandlers;
