import type { NextFunction, Response } from 'express';
import { translateWithDefault } from '../../../helpers/translate.ts';
import type { StandardSchemaV1 } from '../../validate/types.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import BaseMiddleware, { type AuthParameter } from './BaseMiddleware.ts';

export type { AuthParameter } from './BaseMiddleware.ts';

/**
 * Middleware with the 5.x contract `(req, res, next)`. New middleware extend
 * `Middleware` (`(ctx, next)`) instead; this class is removed in v6.
 */
class AbstractMiddleware extends BaseMiddleware {
  /** @deprecated Renamed to {@link authSchemes}; removed in v6. */
  static get usedAuthParameters(): AuthParameter[] {
    // `this` is the concrete subclass, so its `authSchemes` override answers.
    return this.authSchemes;
  }

  /**
   * @deprecated Since 5.0.0 — declare auth schemes **statically**
   * (`static get authSchemes()`). The instance form will be removed in v6.
   */
  get usedAuthParameters(): AuthParameter[] {
    return [];
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

  /**
   * Translate a message with an in-code English default. The default is the
   * source of truth: it is returned when the request carries no i18n (direct
   * instantiation, i18n disabled), when the key is absent from the app's
   * locales, or when `t()` gives back something that is not a string
   * (malformed resource / `returnObjects`). A present key always wins.
   */
  protected translate(
    req: FrameworkRequest,
    key: string,
    defaultValue: string,
  ): string {
    return translateWithDefault(req, key, defaultValue);
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
}

export default AbstractMiddleware;
