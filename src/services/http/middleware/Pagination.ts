import { object, number } from 'yup';
import AbstractMiddleware from './AbstractMiddleware.ts';

import type { Response, NextFunction } from 'express';
import type { FrameworkRequest } from '../HttpServer.ts';

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

  // eslint-disable-next-line class-methods-use-this
  get relatedQueryParameters() {
    return object().shape({
      page: number(),
      limit: number(),
    });
  }

  async middleware(
    req: FrameworkRequest & PaginationMiddlewareAppInfo,
    res: Response,
    next: NextFunction,
  ) {
    let { limit, maxLimit } = this.params;

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
