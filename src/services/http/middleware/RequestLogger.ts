import type { Next, RequestContext } from '../RequestContext.ts';
import Middleware from './Middleware.ts';

class RequestLogger extends Middleware {
  static get description() {
    return 'Log info about the request';
  }

  async middleware(ctx: RequestContext<object>, next: Next) {
    // Log the path only, not the URL — the query string can carry secrets
    // (e.g. `/auth/verify?verification_token=…`).
    const path = ctx.url.pathname;
    const text = `Request is  [${ctx.method}] ${path}`;
    // Probes hit the built-in Health controller (default mount) every few
    // seconds: log them only when they fail.
    const isProbe = path.startsWith('/health/');
    if (!isProbe) {
      this.logger?.info(text);
    }
    ctx.onFinish(({ outcome, status = 0, durationMs }) => {
      if (outcome !== 'finished' || (isProbe && status < 400)) {
        return;
      }
      this.logger?.[isProbe ? 'warn' : 'info'](
        `Finished ${text}. Status: ${status}.  [${durationMs.toFixed(2)} ms]`,
      );
    });
    return next();
  }
}

export default RequestLogger;
