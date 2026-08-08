import type { Response } from 'express';
import AbstractController from '../../../modules/AbstractController.ts';
import { defineSchema } from '../../../services/validate/defineSchema.ts';
import type { GetOneRequest } from './ParamsOnly.routes.gen.ts';

/**
 * Golden fixture for a controller whose ONLY schema is `params:`.
 *
 * Regression pin: emitting the `routes` type alias (and the controller
 * self-import that makes it resolvable) was gated on a route having a
 * `request:` or `query:` schema. A params-only controller therefore got no
 * alias, `navigateSchema` was false, and the `appInfo.params` override was
 * silently dropped — the field degraded to the permissive base
 * `Record<string, unknown>`. `Schemas.ts` could not catch it because it also
 * declares a `request:` schema, which produced the alias for the whole file.
 */
class ParamsOnly extends AbstractController {
  get routes() {
    return {
      get: {
        '/:code': {
          handler: this.getOne,
          params: defineSchema<{ code: number }>((value) => {
            const v = (value ?? {}) as Record<string, unknown>;
            return { value: { code: Number(v.code ?? 0) } };
          }),
        },
      },
    };
  }

  async getOne(req: GetOneRequest, res: Response) {
    // The gate: with no alias emitted this is `unknown` and stops compiling.
    const code: number = req.appInfo.params.code;
    const raw: string = req.params.code;
    return res.json({ code, raw });
  }
}

export default ParamsOnly;
