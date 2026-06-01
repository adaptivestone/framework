import type { NextFunction, Response } from 'express';
import type { FrameworkRequest } from '../../../services/http/HttpServer.ts';
import AbstractMiddleware from '../../../services/http/middleware/AbstractMiddleware.ts';
import { defineSchema } from '../../../services/validate/defineSchema.ts';
import type { StandardSchemaV1 } from '../../../services/validate/types.ts';

/**
 * Fixture that declares its query schema via the DEPRECATED instance getter, to
 * verify the back-compat fallback path (detect override → instantiate → read
 * instance form → warn) still validates.
 */
class DeprecatedSchemaMiddleware extends AbstractMiddleware {
  get relatedQueryParameters(): StandardSchemaV1 {
    return defineSchema<{ count?: number }>((value) => {
      const v = (value ?? {}) as Record<string, unknown>;
      if (v.count === undefined || v.count === null || v.count === '') {
        return { value: {} };
      }
      const n = Number(v.count);
      if (Number.isNaN(n)) {
        return {
          issues: [{ message: 'count must be a number', path: ['count'] }],
        };
      }
      return { value: { count: n } };
    });
  }

  async middleware(_req: FrameworkRequest, _res: Response, next: NextFunction) {
    return next();
  }
}

export default DeprecatedSchemaMiddleware;
