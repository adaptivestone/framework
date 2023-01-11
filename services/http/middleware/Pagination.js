const AbstractMiddleware = require('./AbstractMiddleware');

/**
 * Middleware for reusing pagination
 */
class Pagination extends AbstractMiddleware {
  static get description() {
    return 'Pagination middleware. You can use limit=10 and maxLimit=100 parameters';
  }

  async middleware(req, res, next) {
    let { limit, maxLimit } = this.params;

    limit = typeof limit === 'number' ? parseInt(limit, 10) : 10;
    maxLimit = typeof maxLimit === 'number' ? parseInt(maxLimit, 10) : 100;

    req.appInfo.pagination = {};
    req.appInfo.pagination.page =
      typeof req?.query?.page === 'string'
        ? parseInt(req?.query?.page, 10) || 1
        : 1;

    req.appInfo.pagination.limit =
      typeof req?.query?.limit === 'string'
        ? parseInt(req?.query?.limit, 10) || 0
        : limit;

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

module.exports = Pagination;
