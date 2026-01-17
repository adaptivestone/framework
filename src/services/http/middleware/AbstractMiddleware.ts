import type { NextFunction, Response } from 'express';
import { object } from 'yup';
import Base from '../../../modules/Base.ts';
import type { IApp } from '../../../server.ts';
import type { FrameworkRequest } from '../HttpServer.ts';

class AbstractMiddleware extends Base {
  params?: Record<string, unknown>;

  constructor(app: IApp, params?: Record<string, unknown>) {
    super(app);
    this.params = params;
  }

  static get description() {
    return 'Middleware description. Please provide own';
  }

  get usedAuthParameters(): Array<{
    name: string;
    type: string;
    in?: string;
    scheme?: string;
    description: string;
  }> {
    return [];
  }

  get relatedQueryParameters() {
    // For example  yup.object().shape({page: yup.number().required(),limit: yup.number()})
    return object().shape({});
  }

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

  async middleware(
    _req: FrameworkRequest,
    _res: Response,
    next: NextFunction,
  ): Promise<void | Response> {
    this.logger?.warn('Middleware is not implemented');
    return next();
  }

  getMiddleware() {
    return this.middleware.bind(this);
  }

  static get loggerGroup() {
    return 'middleware';
  }
}

export default AbstractMiddleware;
