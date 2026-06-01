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
   * Schema describing query parameters this middleware consumes. Declared
   * **statically** so the framework (and codegen) can read it without
   * instantiating the middleware. Override with any Standard Schema-conformant
   * schema (Zod, Valibot, ArkType, yup ≥1.7, `defineSchema`). Default `null`.
   *
   * Example:
   *   static get relatedQueryParameters() {
   *     return z.object({ page: z.number(), limit: z.number() });
   *   }
   */
  static get relatedQueryParameters(): StandardSchemaV1 | null {
    return null;
  }

  /**
   * Schema describing request-body parameters this middleware consumes. Static;
   * same rules as `relatedQueryParameters`.
   */
  static get relatedRequestParameters(): StandardSchemaV1 | null {
    return null;
  }

  /**
   * @deprecated Since 5.0.0-beta.51 — declare the schema **statically**
   * (`static get relatedQueryParameters()`) instead. The instance form forces
   * the framework to instantiate the middleware just to read the schema (which
   * runs its constructor side effects); it will be removed in v6.
   */
  get relatedQueryParameters(): StandardSchemaV1 | null {
    return null;
  }

  /**
   * @deprecated Since 5.0.0-beta.51 — use `static get relatedRequestParameters()`.
   * Removed in v6.
   */
  get relatedRequestParameters(): StandardSchemaV1 | null {
    return null;
  }

  /**
   * @deprecated Since 5.0.0-beta.51 — read the static getters instead.
   * Removed in v6.
   */
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
