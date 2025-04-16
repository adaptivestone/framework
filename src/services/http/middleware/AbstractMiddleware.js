import { object } from 'yup';
import Base from '../../../modules/Base.js';

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
    // For example  yup.object().shape({page: yup.number().required(),limit: yup.number()})
    return object().shape({});
  }

  // eslint-disable-next-line class-methods-use-this
  get relatedRequestParameters() {
    // For example  yup.object().shape({page: yup.number().required(),limit: yup.number()})
    return object().shape({});
  }

  get relatedReqParameters() {
    return {
      request: this.relatedRequestParameters,
      query: this.relatedQueryParameters,
    };
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

export default AbstractMiddleware;
