/**
 * The portable request pipeline: middleware, then the handler, as a strict
 * onion. No HTTP library is imported here; an adapter creates the
 * `RequestContext`, runs the pipeline and writes the returned response.
 *
 * Contract for each layer: `return next()` continues, a returned
 * `HttpResponse` stops, a throw travels up through every layer unchanged and
 * is turned into a response once, at the top, by `handleRequest`.
 *
 * Guards (always on): `next()` always returns a Promise; it works once — a
 * second call while the request runs fails the request; it is refused once its
 * own middleware call has settled or the request has chosen its response —
 * such a late call is only refused, the chosen response stands; the runner
 * waits for every suffix that was started (later middleware, the handler,
 * wrapper cleanup) before answering; no misuse leaves an unhandled rejection;
 * the final value must be an `HttpResponse`. With `diagnostics`, each layer's
 * result is also checked and the layer that broke the rule is named.
 */
import type Middleware from './middleware/Middleware.ts';
import { type Next, RequestContext } from './RequestContext.ts';
import { runInRequestScope } from './requestScope.ts';
import { HttpResponse } from './responses.ts';

/** The handler at the end of the chain. */
export type Handler<C extends RequestContext<object>> = (
  ctx: C,
) => HttpResponse | Promise<HttpResponse>;

/** One layer of the chain: a name for messages and the call itself. */
export interface Layer<C extends RequestContext<object>> {
  readonly name: string;
  run(ctx: C, next: Next): HttpResponse | Promise<HttpResponse>;
}

export interface ChainOptions {
  /**
   * Check every layer's result and name the layer that broke a rule (for
   * example "Auth must return a response — missing `return next()`?"). Costs
   * one more promise per layer; meant for development.
   */
  diagnostics?: boolean;
}

/** Runs a composed chain for one request; rejects with the raw error. */
export type Chain<C extends RequestContext<object>> = (
  ctx: C,
) => Promise<HttpResponse>;

interface RequestState {
  settled: boolean;
  started: Promise<HttpResponse>[];
  misuse: Error | undefined;
}

const noop = () => {};

/** A rejection that can never be reported as unhandled. */
function rejected(error: unknown): Promise<never> {
  const promise = Promise.reject(error);
  promise.then(undefined, noop);
  return promise;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function notAResponse(name: string): TypeError {
  return new TypeError(
    `${name} must return a response (missing "return next()"?)`,
  );
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('The client went away');
}

/**
 * Run one layer with the guards. `suffix` starts the rest of the chain; it is
 * called at most once, through `next`.
 */
function guardedLayer<C extends RequestContext<object>>(
  state: RequestState,
  layer: Layer<C>,
  ctx: C,
  suffix: () => HttpResponse | Promise<HttpResponse>,
  diagnostics: boolean,
): HttpResponse | Promise<HttpResponse> {
  let phase = 0; // 0 open, 1 next() called, 2 this call settled
  let downstream: Promise<HttpResponse> | undefined;
  const refuse = (message: string, failRequest: boolean): Promise<never> => {
    const error = new Error(`${layer.name}: ${message}`);
    if (failRequest && !state.settled) {
      state.misuse ??= error;
    }
    return rejected(error);
  };
  const next: Next = () => {
    if (phase === 1) {
      return refuse('next() called twice', true);
    }
    if (phase === 2 || state.settled) {
      return refuse('next() called after its middleware finished', false);
    }
    phase = 1;
    try {
      downstream = Promise.resolve(suffix());
    } catch (error) {
      downstream = rejected(error);
    }
    state.started.push(downstream);
    return downstream;
  };
  let result: HttpResponse | Promise<HttpResponse>;
  try {
    result = layer.run(ctx, next);
  } catch (error) {
    phase = 2;
    throw error;
  }
  if (!isThenable(result)) {
    // A synchronous return settles this call now.
    phase = 2;
    if (diagnostics && !HttpResponse.is(result)) {
      throw notAResponse(layer.name);
    }
    return result;
  }
  const expire = () => {
    phase = 2;
  };
  if (!diagnostics) {
    // Also marks the layer's own result as handled.
    result.then(expire, expire);
    return result;
  }
  const checked = result.then(
    (value) => {
      expire();
      if (!HttpResponse.is(value)) {
        throw notAResponse(layer.name);
      }
      return value;
    },
    (error: unknown) => {
      expire();
      throw error;
    },
  );
  checked.then(undefined, noop);
  return checked;
}

/** Wait for every started suffix, then check what the chain produced. */
function settle(
  state: RequestState,
  failed: boolean,
  value: unknown,
): HttpResponse | Promise<HttpResponse> {
  state.settled = true;
  const done = (): HttpResponse => {
    if (state.misuse) {
      throw state.misuse;
    }
    if (failed) {
      throw value;
    }
    if (!HttpResponse.is(value)) {
      throw new TypeError('The middleware chain did not return a response');
    }
    return value;
  };
  return state.started.length > 0
    ? Promise.allSettled(state.started).then(done)
    : done();
}

/**
 * Compose `layers` and `handler` once (per route, at startup). The result runs
 * one request and resolves to its response or rejects with the raw error.
 */
export function composeChain<C extends RequestContext<object>>(
  layers: readonly Layer<C>[],
  handler: Handler<C>,
  options: ChainOptions = {},
): Chain<C> {
  const diagnostics = options.diagnostics ?? false;
  const count = layers.length;
  const invoke = (
    ctx: C,
    state: RequestState,
    index: number,
  ): HttpResponse | Promise<HttpResponse> => {
    if (ctx.signal.aborted) {
      throw abortReason(ctx.signal);
    }
    if (index === count) {
      const result = handler(ctx);
      if (isThenable(result)) {
        // A misused next() must not leave the handler's rejection unhandled.
        result.then(undefined, noop);
      }
      return result;
    }
    const layer = layers[index] as Layer<C>;
    return guardedLayer(
      state,
      layer,
      ctx,
      () => invoke(ctx, state, index + 1),
      diagnostics,
    );
  };
  return (ctx) => {
    const state: RequestState = {
      settled: false,
      started: [],
      misuse: undefined,
    };
    let top: Promise<HttpResponse>;
    try {
      top = Promise.resolve(invoke(ctx, state, 0));
    } catch (error) {
      top = Promise.reject(error);
    }
    return top.then(
      (value) => settle(state, false, value),
      (error: unknown) => settle(state, true, error),
    );
  };
}

/** A `Middleware` instance as a chain layer. */
export function middlewareLayer(instance: Middleware): Layer<RequestContext> {
  return {
    name: instance.constructor.name,
    run: (ctx, next) => instance.middleware(ctx, next),
  };
}

/**
 * Run one request: the chain inside the request's scope (so
 * `requestContext()` works in everything it starts), and an error that
 * reached the top turned into a response by `resolveError` — the error
 * registry — exactly once. The original error is kept on `ctx.error`.
 */
export function handleRequest<C extends RequestContext<object>>(
  ctx: C,
  chain: Chain<C>,
  resolveError: (
    error: unknown,
    ctx: C,
  ) => HttpResponse | Promise<HttpResponse>,
): Promise<HttpResponse> {
  return runInRequestScope(ctx, async () => {
    try {
      return await chain(ctx);
    } catch (error) {
      RequestContext.recordError(ctx, error);
      return resolveError(error, ctx);
    }
  });
}
