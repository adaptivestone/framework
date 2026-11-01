import type { Next, RequestContext } from '../RequestContext.ts';
import type { BaseAppInfo } from '../types.ts';
import Middleware from './Middleware.ts';

class PrepareAppInfo extends Middleware {
  static get description() {
    return 'Basic middleware that creates "req.appInfo" object';
  }

  async middleware(ctx: RequestContext<object>, next: Next) {
    // `request`/`query`/`params` are declared non-optional; seed all three so
    // a schema-less route's handler can read them. The validation wrapper
    // overwrites (assigns, not merges) when a route declares schemas, so
    // these defaults never leak stale keys. `ip`/`i18n` are optional and set
    // by later middleware.
    const appInfo = ctx.appInfo as Partial<BaseAppInfo>;
    appInfo.app ??= this.app;
    appInfo.request ??= {};
    appInfo.query ??= {};
    appInfo.params ??= {};
    return next();
  }
}

export default PrepareAppInfo;
