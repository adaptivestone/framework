// biome-ignore-all lint: type-check fixture; run: npx tsc --ignoreConfig --strict --noEmit --skipLibCheck --target es2022 --module nodenext <this file>
// Expected: errors for ForgotSync, ForgotAsync, ForgotBranch (forgotten return next()); none for Auth; Unawaited is not detectable by types.
declare const brand: unique symbol;
interface HttpResponse {
  readonly [brand]: true;
  status: number;
}
interface RequestContext {
  appInfo: { user?: { id: string } };
}
type Next = () => Promise<HttpResponse>;

abstract class Middleware {
  abstract middleware(
    ctx: RequestContext,
    next: Next,
  ): HttpResponse | Promise<HttpResponse>;
}

// 1. correct
class Auth extends Middleware {
  middleware(ctx: RequestContext, next: Next) {
    if (!ctx.appInfo.user) throw new Error('401');
    return next();
  }
}
// 2. forgotten return, sync
class ForgotSync extends Middleware {
  middleware(ctx: RequestContext, next: Next) {
    next();
  }
}
// 3. forgotten return, async with await
class ForgotAsync extends Middleware {
  async middleware(ctx: RequestContext, next: Next) {
    await next();
  }
}
// 4. forgotten return on one branch only
class ForgotBranch extends Middleware {
  async middleware(ctx: RequestContext, next: Next) {
    if (ctx.appInfo.user) return next();
  }
}
// 5. next() called without await, other response returned (types cannot see this)
class Unawaited extends Middleware {
  async middleware(ctx: RequestContext, next: Next) {
    next();
    return { status: 202 } as unknown as HttpResponse;
  }
}
