/**
 * Runs a route as a v2 chain (strict onion, `RequestContext`) on Express.
 * Used when a route's middleware include a v2 `Middleware`; routes with only
 * 5.x middleware keep the 5.x dispatch in `ExpressAdapter`.
 *
 * 5.x code inside a v2 chain keeps its calling convention:
 * - a v1 middleware gets `(req, res, next)`; `next()` continues (after the
 *   middleware's own synchronous code, outside any AsyncLocalStorage scope it
 *   opened); `next(err)`, a throw or a rejection fails the chain with the
 *   original value; ending the response yields the `sent` response;
 * - a v1 handler's errors escape to the v2 middleware first (a transaction
 *   rolls back) and are resolved once at the top, exactly as the 5.x
 *   controller would have answered them;
 * - a response written through `res` yields `sent` once it finishes; headers
 *   staged on `ctx.response` are flushed when 5.x code commits headers;
 *   staging after that throws.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { IApp } from '../../../server.ts';
import { answerError, validationFallback } from '../answerError.ts';
import { producedBuiltInResponse } from '../builtInResponse.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import type AbstractMiddleware from '../middleware/AbstractMiddleware.ts';
import Middleware from '../middleware/Middleware.ts';
import {
  type Chain,
  composeChain,
  handleRequest,
  type Layer,
  middlewareLayer,
} from '../pipeline.ts';
import {
  type Next,
  RequestContext,
  type RequestSource,
  type ResponseStaging,
} from '../RequestContext.ts';
import type { ResponseWriter } from '../ResponseWriter.ts';
import { runInRequestScope } from '../requestScope.ts';
import { HttpResponse, legacySentResponse } from '../responses.ts';
import type { HandlerEntry, MiddlewareEntry } from './RouteNode.ts';

type Ctx = RequestContext;

interface Binding {
  req: Request;
  res: Response;
  next: NextFunction;
  transport: ExpressTransport;
}

/** The Express objects behind a context, for the 5.x layers of its chain. */
const bindings = new WeakMap<Ctx, Binding>();

const instanceCache = new WeakMap<
  MiddlewareEntry,
  AbstractMiddleware | Middleware
>();

/** The one instance of a middleware entry (constructed on first use). */
export function middlewareInstance(
  app: IApp,
  entry: MiddlewareEntry,
): AbstractMiddleware | Middleware {
  let instance = instanceCache.get(entry);
  if (!instance) {
    // Default params to `{}` — matches legacy behaviour and keeps middleware
    // that destructure `this.params` from crashing.
    instance = new entry.Class(app, entry.params ?? {});
    instanceCache.set(entry, instance);
  }
  return instance;
}

/** Is this entry a v2 `Middleware`? */
export function isV2Middleware(entry: MiddlewareEntry): boolean {
  return entry.Class.prototype instanceof Middleware;
}

/** Apply staged headers to `res`. `keepExisting`: never replace a header 5.x code set. */
function applyStaged(
  res: Response,
  staging: ResponseStaging,
  keepExisting: boolean,
): void {
  const grouped = new Map<string, string[]>();
  for (const [name, value] of staging.entries()) {
    const values = grouped.get(name);
    if (values) {
      values.push(value);
    } else {
      grouped.set(name, [value]);
    }
  }
  for (const [name, values] of grouped) {
    if (name === 'set-cookie') {
      res.append('Set-Cookie', values);
    } else if (name === 'vary') {
      for (const value of values) {
        res.vary(value);
      }
    } else if (!keepExisting || !res.hasHeader(name)) {
      res.setHeader(name, values.length === 1 ? (values[0] as string) : values);
    }
  }
}

/** The client went away before the response finished. */
class ClientGoneError extends Error {
  constructor() {
    super('The client closed the connection');
    this.name = 'AbortError';
  }
}

/**
 * Watches one response: completion (`onFinish`), client abort (`ctx.signal`)
 * and the moment 5.x code commits headers (staged headers are flushed).
 */
class ExpressTransport {
  readonly #res: Response;

  #ctx: Ctx | undefined;

  #abort: AbortController | undefined;

  #closedEarly = false;

  #failure: { error: unknown } | undefined;

  #staged = false;

  constructor(res: Response) {
    this.#res = res;
    res.once('finish', () => {
      if (this.#ctx) {
        RequestContext.finish(this.#ctx, {
          outcome: 'finished',
          status: res.statusCode,
        });
      }
    });
    res.once('close', () => {
      if (res.writableFinished) {
        return;
      }
      this.#closedEarly = true;
      this.#abort?.abort(new ClientGoneError());
      if (this.#ctx) {
        RequestContext.finish(
          this.#ctx,
          this.#failure
            ? { outcome: 'failed', error: this.#failure.error }
            : { outcome: 'aborted' },
        );
      }
    });
    // 5.x code that writes `res` commits headers here: flush staged ones first.
    const writeHead = res.writeHead;
    res.writeHead = ((...args: Parameters<Response['writeHead']>) => {
      res.writeHead = writeHead;
      this.flushStaged(true);
      return writeHead.apply(res, args);
    }) as Response['writeHead'];
  }

  attach(ctx: Ctx): void {
    this.#ctx = ctx;
  }

  get signal(): AbortSignal {
    if (!this.#abort) {
      this.#abort = new AbortController();
      if (this.#closedEarly) {
        this.#abort.abort(new ClientGoneError());
      }
    }
    return this.#abort.signal;
  }

  get closedEarly(): boolean {
    return this.#closedEarly;
  }

  /** Apply the context's staged headers once, then refuse further staging. */
  flushStaged(keepExisting: boolean): void {
    if (this.#staged || !this.#ctx) {
      return;
    }
    this.#staged = true;
    applyStaged(this.#res, this.#ctx.response, keepExisting);
    this.#ctx.response.seal();
  }

  /** The write failed after headers were sent; `onFinish` reports `failed`. */
  fail(error: unknown): void {
    this.#failure = { error };
  }

  /** Settles when a response written through `res` ends. */
  legacyOutcome(): Promise<HttpResponse> {
    const res = this.#res;
    if (res.writableFinished) {
      return Promise.resolve(legacySentResponse(res.statusCode));
    }
    if (this.#closedEarly) {
      return Promise.reject(new ClientGoneError());
    }
    return new Promise((resolve, reject) => {
      const onFinish = () => {
        res.off('close', onClose);
        resolve(legacySentResponse(res.statusCode));
      };
      const onClose = () => {
        res.off('finish', onFinish);
        if (res.writableFinished) {
          resolve(legacySentResponse(res.statusCode));
        } else {
          reject(new ClientGoneError());
        }
      };
      res.once('finish', onFinish);
      res.once('close', onClose);
    });
  }
}

/** `RequestSource` over an Express request, read lazily. */
function expressSource(
  req: Request,
  transport: ExpressTransport,
): RequestSource {
  let path: string | undefined;
  return {
    get method() {
      return req.method;
    },
    get url() {
      return req.originalUrl ?? req.url;
    },
    get origin() {
      return `${req.protocol}://${req.get('host') ?? 'localhost'}`;
    },
    get path() {
      if (path === undefined) {
        try {
          path = decodeURIComponent(req.path);
        } catch {
          path = req.path;
        }
      }
      return path;
    },
    get headers() {
      return req.headers;
    },
    get route() {
      const template = (req.route as { path?: string } | undefined)?.path;
      return template && template !== 'unmatched' ? template : undefined;
    },
    get params() {
      return req.params as Record<string, string>;
    },
    get query() {
      return req.query as Record<string, unknown>;
    },
    get body() {
      return req.body;
    },
    get signal() {
      return transport.signal;
    },
  };
}

/** A 5.x `(req, res, next)` middleware as a chain layer. */
function legacyMiddlewareLayer(app: IApp, entry: MiddlewareEntry): Layer<Ctx> {
  const name = entry.Class.name;
  return {
    name,
    run(ctx: Ctx, next: Next): Promise<HttpResponse> {
      const binding = bindings.get(ctx) as Binding;
      const { req, res, transport } = binding;
      const instance = middlewareInstance(app, entry) as AbstractMiddleware;
      // The suffix starts in this layer's async context, not in a scope the
      // 5.x middleware may have opened around its `next()` call.
      const resume = AsyncLocalStorage.snapshot();
      return new Promise<HttpResponse>((resolve, reject) => {
        let settled = false;
        const settle = (finish: () => void) => {
          if (settled) {
            return false;
          }
          settled = true;
          res.off('finish', onEnded);
          res.off('close', onEnded);
          finish();
          return true;
        };
        const onEnded = () => {
          settle(() => {
            transport.legacyOutcome().then(resolve, reject);
          });
        };
        res.once('finish', onEnded);
        res.once('close', onEnded);
        const nextFn = (err?: unknown) => {
          const failed =
            err !== undefined &&
            err !== null &&
            err !== false &&
            err !== 'route' &&
            err !== 'router';
          const handled = settle(() => {
            if (failed) {
              reject(err);
            } else {
              // After the middleware's own synchronous code, like 5.x.
              queueMicrotask(() => {
                resolve(resume(() => next()));
              });
            }
          });
          if (!handled && failed) {
            app.logger.error(
              `Middleware ${name} rejected after settling: ${
                err instanceof Error ? (err.stack ?? err.message) : err
              }`,
            );
          }
        };
        try {
          Promise.resolve(
            instance.middleware(req as FrameworkRequest, res, nextFn),
          ).catch((err: unknown) => {
            if (!settle(() => reject(err))) {
              app.logger.error(
                `Middleware ${name} rejected after settling: ${
                  err instanceof Error ? (err.stack ?? err.message) : err
                }`,
              );
            }
          });
        } catch (err) {
          settle(() => reject(err));
        }
      });
    },
  };
}

/** The route's handler as the last layer: returned responses or 5.x `res` writes. */
function handlerCall(
  entry: HandlerEntry,
  onDroppedResponse: (entry: HandlerEntry) => void,
) {
  const run = entry.rawHandler ?? entry.handler;
  const name = `${entry.meta?.controllerClass ?? 'Controller'}.${entry.meta?.methodName ?? 'handler'}`;
  return async (ctx: Ctx): Promise<HttpResponse> => {
    const { req, res, next, transport } = bindings.get(ctx) as Binding;
    const returned = await run(req, res, next, ctx);
    if (entry.contract === 2) {
      if (!HttpResponse.is(returned)) {
        throw new TypeError(
          `${name} must return an HttpResponse (it takes ctx and has no res)`,
        );
      }
      return returned;
    }
    if (HttpResponse.is(returned)) {
      if (res.headersSent) {
        throw new Error(
          `${req.method} ${(req.route as { path?: string }).path}: the handler both wrote to res and returned an HttpResponse. Use one or the other.`,
        );
      }
      return returned;
    }
    if (!res.headersSent) {
      const dropped = producedBuiltInResponse(req);
      if (dropped) {
        onDroppedResponse(entry);
        return dropped;
      }
    }
    // Written (or still being written) through `res`.
    return transport.legacyOutcome();
  };
}

interface CachedChain {
  entries: readonly MiddlewareEntry[];
  chain: Chain<Ctx>;
}

const chainCache = new WeakMap<HandlerEntry, CachedChain>();

const sameEntries = (
  a: readonly MiddlewareEntry[],
  b: readonly MiddlewareEntry[],
) => a.length === b.length && a.every((entry, i) => entry === b[i]);

/** Compose (once per route) the chain for this handler and middleware list. */
function chainFor(
  app: IApp,
  entry: HandlerEntry,
  middlewares: readonly MiddlewareEntry[],
  onDroppedResponse: (entry: HandlerEntry) => void,
): Chain<Ctx> {
  const cached = chainCache.get(entry);
  if (cached && sameEntries(cached.entries, middlewares)) {
    return cached.chain;
  }
  const layers = middlewares.map((mw) =>
    isV2Middleware(mw)
      ? middlewareLayer(middlewareInstance(app, mw) as Middleware)
      : legacyMiddlewareLayer(app, mw),
  );
  const chain = composeChain(layers, handlerCall(entry, onDroppedResponse), {
    diagnostics: process.env.NODE_ENV !== 'production',
  });
  chainCache.set(entry, { entries: [...middlewares], chain });
  return chain;
}

/** Run one matched route as a v2 chain and write its response. */
export async function dispatchV2(
  app: IApp,
  writer: ResponseWriter<Request, Response>,
  entry: HandlerEntry,
  middlewares: readonly MiddlewareEntry[],
  req: Request,
  res: Response,
  next: NextFunction,
  onDroppedResponse: (entry: HandlerEntry) => void,
): Promise<void> {
  const frameworkReq = req as FrameworkRequest;
  const transport = new ExpressTransport(res);
  const ctx = new RequestContext(
    expressSource(req, transport),
    frameworkReq.appInfo as Ctx['appInfo'],
    {
      runInScope: runInRequestScope,
      reportError: (message, error) =>
        app.logger?.error(
          `${message}: ${error instanceof Error ? (error.stack ?? error.message) : error}`,
        ),
    },
  );
  transport.attach(ctx);
  bindings.set(ctx, { req, res, next, transport });
  const chain = chainFor(app, entry, middlewares, onDroppedResponse);
  const response = await handleRequest(ctx, chain, async (error) => {
    if (transport.closedEarly) {
      // The client is gone: nothing will be written, nothing to resolve.
      return legacySentResponse(0);
    }
    if (res.headersSent) {
      // 5.x code already committed a response, then something failed: no
      // second response is possible. Log it; `onFinish` reports the outcome.
      app.logger?.error(
        `Request failed after the response started: ${
          error instanceof Error ? (error.stack ?? error.message) : error
        }`,
      );
      return legacySentResponse(res.statusCode);
    }
    return answerError(
      app,
      app.logger,
      error,
      frameworkReq,
      validationFallback(error, frameworkReq),
    );
  });
  if (response.kind === 'sent' || transport.closedEarly) {
    return;
  }
  if (res.headersSent) {
    // 5.x code already wrote the response and a v2 middleware returned a
    // different one: the bytes are gone, so report it instead of writing twice.
    app.logger?.error(
      `${req.method} ${req.originalUrl}: a middleware replaced a response that 5.x code had already sent; the replacement was not sent`,
    );
    return;
  }
  if (res.destroyed) {
    return;
  }
  transport.flushStaged(false);
  try {
    await writer.write(response, req, res);
  } catch (err) {
    if (!res.headersSent) {
      next(err);
      return;
    }
    transport.fail(err);
    app.logger?.error(
      `Response failed after it started: ${
        err instanceof Error ? (err.stack ?? err.message) : err
      }`,
    );
    res.destroy();
  }
}
