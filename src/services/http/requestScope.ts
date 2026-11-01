import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from './RequestContext.ts';

const store = new AsyncLocalStorage<RequestContext<object>>();

/**
 * The context of the request being handled, from anywhere in its async work
 * (services, models, loggers), or `undefined` outside a request.
 */
export function requestContext<
  C extends RequestContext<object> = RequestContext,
>(): C | undefined {
  return store.getStore() as C | undefined;
}

/** @internal Run `fn` (and the async work it starts) inside `ctx`'s scope. */
export function runInRequestScope<T>(
  ctx: RequestContext<object>,
  fn: () => T,
): T {
  return store.run(ctx, fn);
}
