import type { NextFunction, Response } from 'express';
import Base from '../../../modules/Base.ts';
import type { IApp } from '../../../server.ts';
import type { StandardSchemaV1 } from '../../validate/types.ts';
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

  /**
   * Optional schema describing query parameters consumed by this middleware.
   * Override with any Standard Schema-conformant schema (Yup, Zod, Valibot,
   * ArkType, custom). Default `null` — no schema declared.
   *
   * Example:
   *   get relatedQueryParameters() {
   *     return yup.object().shape({ page: yup.number(), limit: yup.number() });
   *   }
   */
  get relatedQueryParameters(): StandardSchemaV1 | null {
    return null;
  }

  /**
   * Optional schema describing request-body parameters consumed by this
   * middleware. Same shape rules as `relatedQueryParameters`.
   */
  get relatedRequestParameters(): StandardSchemaV1 | null {
    return null;
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
  ): // biome-ignore lint/suspicious/noConfusingVoidType: Express middleware legitimately returns void or Response
  Promise<void | Response> {
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
