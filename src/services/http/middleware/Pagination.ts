import type { NextFunction, Response } from 'express';
import { defineSchema } from '../../validate/defineSchema.ts';
import type { StandardSchemaV1 } from '../../validate/types.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';

export interface PaginationMiddlewareAppInfo {
  appInfo: {
    pagination: {
      page: number;
      limit: number;
      skip: number;
    };
  };
}

/**
 * Middleware for reusing pagination
 */
class Pagination extends AbstractMiddleware {
  static get description() {
    return 'Pagination middleware. You can use limit=10 and maxLimit=100 parameters';
  }

  static get provides() {
    return {} as PaginationMiddlewareAppInfo['appInfo'];
  }

  get relatedQueryParameters() {
    return defineSchema<{ page?: number; limit?: number }>((value) => {
      const v = (value ?? {}) as Record<string, unknown>;
      const issues: StandardSchemaV1.Issue[] = [];
      const out: { page?: number; limit?: number } = {};
      for (const key of ['page', 'limit'] as const) {
        if (v[key] === undefined || v[key] === null || v[key] === '') {
          continue;
        }
        const n = Number(v[key]);
        if (Number.isNaN(n)) {
          issues.push({ message: `${key} must be a number`, path: [key] });
        } else {
          out[key] = n;
        }
      }
      if (issues.length) {
        return { issues };
      }
      return { value: out };
    });
  }

  async middleware(
    req: FrameworkRequest & PaginationMiddlewareAppInfo,
    _res: Response,
    next: NextFunction,
  ) {
    let { limit, maxLimit } = this.params as {
      limit: number;
      maxLimit: number;
    };

    limit = (typeof limit !== 'number' ? parseInt(limit, 10) : limit) || 10;
    maxLimit =
      (typeof maxLimit !== 'number' ? parseInt(maxLimit, 10) : maxLimit) || 100;

    req.appInfo.pagination = {
      page:
        typeof req?.query?.page === 'string'
          ? parseInt(req?.query?.page, 10) || 1
          : 1,

      limit:
        typeof req?.query?.limit === 'string'
          ? parseInt(req?.query?.limit, 10) || 0
          : limit,
      skip: 0,
    };

    if (req.appInfo.pagination.limit > maxLimit) {
      req.appInfo.pagination.limit = maxLimit;
    }

    if (req.appInfo.pagination.page < 1) {
      req.appInfo.pagination.page = 1;
    }

    if (req.appInfo.pagination.limit < 0) {
      req.appInfo.pagination.limit = 0;
    }

    req.appInfo.pagination.skip =
      req.appInfo.pagination.page * req.appInfo.pagination.limit -
      req.appInfo.pagination.limit;

    return next();
  }
}

export default Pagination;
