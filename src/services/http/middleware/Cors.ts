import type { IApp } from '../../../server.ts';
import type { Next, RequestContext } from '../RequestContext.ts';
import { HttpResponse } from '../responses.ts';
import Middleware from './Middleware.ts';

class Cors extends Middleware {
  constructor(
    app: IApp,
    params: {
      origins: (string | RegExp)[];
      /** Response headers browser code may read, e.g. `Retry-After`. */
      exposedHeaders?: string[];
    },
  ) {
    super(app);
    this.params = params;
    if (!Array.isArray(params?.origins) || !params.origins.length) {
      throw new Error('Cors inited without origin config');
    }
    // An unanchored regex matches more than intended — `/example\.com/` also
    // matches evil-example.com. Warn (don't change behavior) so the misconfig
    // is visible at boot.
    for (const origin of params.origins) {
      if (
        origin instanceof RegExp &&
        (!origin.source.startsWith('^') || !origin.source.endsWith('$'))
      ) {
        this.logger?.warn(
          `CORS regex /${origin.source}/ is not anchored — it can match unintended origins (e.g. evil-example.com). Anchor it with ^…$.`,
        );
      }
    }
  }

  static get description() {
    return 'Add CORS headers to request';
  }

  async middleware(ctx: RequestContext<object>, next: Next) {
    const origins = this.params?.origins;
    if (!Array.isArray(origins)) {
      return next();
    }
    // Whether the allow-origin header is sent depends on Origin, so every
    // response varies by it. `vary` adds to other values, never replaces.
    ctx.response.appendHeader('vary', 'Origin');
    const origin = ctx.header('origin');
    for (const host of origins as (string | RegExp)[]) {
      if (
        origin !== undefined &&
        ((typeof host === 'string' && origin === host) ||
          (host instanceof RegExp && host.test(origin)))
      ) {
        ctx.response.setHeader('access-control-allow-origin', origin);

        if (ctx.method === 'OPTIONS') {
          ctx.response.setHeader(
            'access-control-allow-methods',
            'GET,HEAD,PUT,PATCH,POST,DELETE',
          );
          ctx.response.appendHeader('vary', 'Access-Control-Request-Headers');

          const allowedHeaders = ctx.header('access-control-request-headers');
          if (allowedHeaders) {
            ctx.response.setHeader(
              'access-control-allow-headers',
              allowedHeaders,
            );
          }
          return HttpResponse.empty(204, {
            headers: { 'content-length': '0' },
          });
        }

        // Only the actual response needs it; a preflight ignores it.
        const exposedHeaders = this.params?.exposedHeaders as
          | string[]
          | undefined;
        if (exposedHeaders?.length) {
          ctx.response.setHeader(
            'access-control-expose-headers',
            exposedHeaders.join(', '),
          );
        }
      }
    }
    return next();
  }
}

export default Cors;
