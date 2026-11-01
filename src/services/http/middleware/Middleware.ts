import { translateWithDefault } from '../../../helpers/translate.ts';
import type { Next, RequestContext } from '../RequestContext.ts';
import type { HttpResponse } from '../responses.ts';
import BaseMiddleware from './BaseMiddleware.ts';

/**
 * Middleware with the `(ctx, next)` contract. Do the work, then
 * `return next()` to continue; return an `HttpResponse` to stop; throw to
 * fail. Code after `await next()` runs after the rest of the chain, with its
 * response:
 *
 *   class Timing extends Middleware {
 *     async middleware(ctx: RequestContext, next: Next) {
 *       const started = performance.now();
 *       const response = await next();
 *       ctx.response.setHeader('server-timing', `app;dur=${performance.now() - started}`);
 *       return response;
 *     }
 *   }
 *
 * `next()` works once, while this middleware runs. Static metadata
 * (`description`, `authSchemes`, `requiresAuth`, `relatedQueryParameters`,
 * `relatedRequestParameters`, `provides`) works as on `AbstractMiddleware`.
 */
abstract class Middleware extends BaseMiddleware {
  abstract middleware(
    ctx: RequestContext,
    next: Next,
  ): HttpResponse | Promise<HttpResponse>;

  /**
   * Translate a message with an in-code English default. The default is
   * returned when the request carries no i18n, when the key is absent from the
   * app's locales, or when `t()` gives back something that is not a string.
   */
  protected translate(
    ctx: RequestContext<object>,
    key: string,
    defaultValue: string,
  ): string {
    return translateWithDefault(ctx, key, defaultValue);
  }
}

export default Middleware;
