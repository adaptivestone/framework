const Base = require('../../../modules/Base');

class AbstractMiddleware extends Base {
  constructor(app, params) {
    super(app);
    this.params = params;
  }

  static get description() {
    return 'Middleware description. Please provide own';
  }

  static get usedAuthParameters() {
    return [];
  }

  // eslint-disable-next-line class-methods-use-this
  get relatedQueryParameters() {
    // For example:
    // {
    //   name: {
    //     type: 'string',
    //     description: 'Some description',
    //     required: true,
    //   }
    // }
    return {};
  }

  // eslint-disable-next-line class-methods-use-this
  get relatedRequestParameters() {
    // For example:
    // {
    //   name: {
    //     type: 'string',
    //     description: 'Some description',
    //     required: true,
    //   }
    // }
    return {};
  }

  async middleware(req, res, next) {
    this.logger.warn('Middleware is not implemented');
    next();
  }

  getMiddleware() {
    return this.middleware.bind(this);
  }

  static get loggerGroup() {
    return 'middleware';
  }
}

module.exports = AbstractMiddleware;
