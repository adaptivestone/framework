import { defineSchema } from '../../validate/defineSchema.ts';
import type { StandardSchemaV1 } from '../../validate/types.ts';
import type { Next, RequestContext } from '../RequestContext.ts';
import type { AppInfoExtensions, BaseAppInfo } from '../types.ts';
import Middleware from './Middleware.ts';

export interface PaginationMiddlewareAppInfo {
  appInfo: {
    pagination: {
      page: number;
      limit: number;
      skip: number;
    };
  };
}

const paginationQueryParameters = defineSchema<{
  page?: number;
  limit?: number;
}>(
  (value) => {
    const v = (value ?? {}) as Record<string, unknown>;
    const issues: StandardSchemaV1.Issue[] = [];
    const out: { page?: number; limit?: number } = {};
    for (const key of ['page', 'limit'] as const) {
      if (v[key] === undefined || v[key] === null || v[key] === '') {
        continue;
      }
      const n = Number(v[key]);
      // `Infinity` (e.g. hundreds of digits) is no usable page or limit either.
      if (!Number.isFinite(n)) {
        issues.push({ message: `${key} must be a number`, path: [key] });
      } else {
        out[key] = n;
      }
    }
    if (issues.length) {
      return { issues };
    }
    return { value: out };
  },
  {
    jsonSchema: {
      type: 'object',
      properties: {
        page: {
          type: 'number',
          description: 'One-based page number.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return per page.',
        },
      },
    },
  },
);

/**
 * Middleware for reusing pagination
 */
class Pagination extends Middleware {
  static get description() {
    return 'Pagination middleware. You can use limit=10 and maxLimit=100 parameters';
  }

  static get provides() {
    return {} as PaginationMiddlewareAppInfo['appInfo'];
  }

  static get relatedQueryParameters() {
    return paginationQueryParameters;
  }

  async middleware(
    ctx: RequestContext<
      BaseAppInfo &
        AppInfoExtensions &
        Partial<PaginationMiddlewareAppInfo['appInfo']>
    >,
    next: Next,
  ) {
    let { limit, maxLimit } = this.params as {
      limit: number;
      maxLimit: number;
    };

    limit = (typeof limit !== 'number' ? parseInt(limit, 10) : limit) || 10;
    maxLimit =
      (typeof maxLimit !== 'number' ? parseInt(maxLimit, 10) : maxLimit) || 100;

    // A malformed `?limit=` (NaN) or a non-positive value falls back to the
    // configured default — never 0, which Mongoose treats as "no limit" and
    // would bypass `maxLimit`. Then clamp to `maxLimit`.
    const { query } = ctx;
    const requestedLimit =
      typeof query.limit === 'string' ? parseInt(query.limit, 10) : limit;
    let effectiveLimit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? requestedLimit
        : limit;
    if (effectiveLimit > maxLimit) {
      effectiveLimit = maxLimit;
    }

    const requestedPage =
      typeof query.page === 'string' ? parseInt(query.page, 10) : 1;
    // A malformed, non-positive or absurdly large page (hundreds of digits
    // parse to Infinity) falls back to 1, so `skip` is always a safe integer.
    let page =
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;
    if (!Number.isSafeInteger((page - 1) * effectiveLimit)) {
      page = 1;
    }

    ctx.appInfo.pagination = {
      page,
      limit: effectiveLimit,
      skip: (page - 1) * effectiveLimit,
    };

    return next();
  }
}

export default Pagination;
