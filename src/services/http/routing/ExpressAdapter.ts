/**
 * Single-mount adapter. Mount once via `app.express.use(createExpressAdapter(registry, app))`.
 * Dispatches each request through the registry: match → walk middlewares → call handler.
 *
 * Middleware instances are cached by `MiddlewareEntry` identity (WeakMap)
 * — each entry is constructed once on first request and reused thereafter.
 */

import type { NextFunction, Request, Response } from 'express';
import { translateWithDefault } from '../../../helpers/translate.ts';
import type { IApp } from '../../../server.ts';
import { producedBuiltInResponse } from '../builtInResponse.ts';
import { notFoundResponse } from '../builtinErrorHandlers.ts';
import { ExpressResponseWriter } from '../ExpressResponseWriter.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import { FRAMEWORK_ERROR_CODES } from '../httpErrors.ts';
import type AbstractMiddleware from '../middleware/AbstractMiddleware.ts';
import RequestParser from '../middleware/RequestParser.ts';
import type { ResponseWriter } from '../ResponseWriter.ts';
import { HttpResponse } from '../responses.ts';
import {
  dispatchV2,
  expressContext,
  isV2Middleware,
  middlewareInstance,
} from './expressPipeline.ts';
import { getMatchedNode, MalformedPathError } from './match.ts';
import type {
  BodyParsingMode,
  HandlerEntry,
  MatchResult,
  MiddlewareEntry,
  RouteNode,
} from './RouteNode.ts';
import type { RouteRegistry } from './RouteRegistry.ts';

const warnedDroppedResponse = new Set<string>();

/** Once per handler: it called a framework handler and dropped its response. */
function warnDroppedResponse(entry: HandlerEntry): void {
  const name = `${entry.meta?.controllerClass ?? 'Controller'}.${entry.meta?.methodName ?? 'handler'}`;
  if (warnedDroppedResponse.has(name)) {
    return;
  }
  warnedDroppedResponse.add(name);
  process.emitWarning(
    `${name} called a framework handler without returning its response; the response was sent anyway. Return it (\`return super.${entry.meta?.methodName ?? 'handler'}(req, res)\`): v6 will not send a response that was not returned.`,
    { type: 'DeprecationWarning', code: 'ASF_DEP_DROPPED_RESPONSE' },
  );
}

export type ExpressAdapter = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

export interface ExpressAdapterOptions {
  /**
   * App-wide `Middleware` (the `Server` option `middleware`). When present,
   * every request the adapter sees runs as one chain: these, then the route's
   * middleware and handler — or the framework's 400, 404 or 405.
   */
  appMiddleware?: readonly MiddlewareEntry[];
}

/** A chain end that answers with a framework response. */
const answering = (
  methodName: string,
  respond: (req: FrameworkRequest) => HttpResponse,
): HandlerEntry => ({
  handler: (req: FrameworkRequest) => respond(req),
  meta: { controllerClass: 'Framework', methodName },
});

const malformedUrlResponse = (req: FrameworkRequest) =>
  HttpResponse.json(400, {
    error: FRAMEWORK_ERROR_CODES.malformedUrl,
    message: translateWithDefault(req, 'http.malformedUrl', 'Malformed URL'),
  });

const methodNotAllowedResponse = (
  req: FrameworkRequest,
  allowedMethods: readonly string[],
) =>
  HttpResponse.json(
    405,
    {
      error: FRAMEWORK_ERROR_CODES.methodNotAllowed,
      message: translateWithDefault(
        req,
        'http.methodNotAllowed',
        'Method not allowed',
      ),
    },
    { headers: { Allow: allowedMethods.join(', ') } },
  );

const malformedUrlEntry = answering('malformedUrl', malformedUrlResponse);
const notFoundEntry = answering('notFound', notFoundResponse);

export function createExpressAdapter(
  registry: RouteRegistry,
  app: IApp,
  writer: ResponseWriter<Request, Response> = new ExpressResponseWriter(),
  options: ExpressAdapterOptions = {},
): ExpressAdapter {
  const appMiddleware = options.appMiddleware ?? [];
  // The body parser runs first on every matched route, in its `bodyParsing`
  // mode (one instance per mode; `'none'` needs no parser).
  const parsers: Record<'parsed' | 'raw', MiddlewareEntry> = {
    parsed: { Class: RequestParser, params: { bodyParsing: 'parsed' } },
    raw: { Class: RequestParser, params: { bodyParsing: 'raw' } },
  };
  const parserFor = (mode: BodyParsingMode | undefined) =>
    mode === 'none' ? undefined : parsers[mode ?? 'parsed'];
  const routeTemplates = new WeakMap<RouteNode, string>();
  const indexTemplates = () =>
    registry.walk((node, path) => routeTemplates.set(node, path));
  indexTemplates();
  /** Run `entry` behind `middlewares` as a strict-onion chain. */
  const runChain = async (
    entry: HandlerEntry,
    middlewares: readonly MiddlewareEntry[],
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await dispatchV2(
        app,
        writer,
        entry,
        middlewares,
        req,
        res,
        next,
        warnDroppedResponse,
      );
    } catch (err) {
      next(err);
    }
  };
  return async function dispatch(req, res, next) {
    let result: MatchResult | null;
    try {
      result = registry.match(req.method, req.path);
    } catch (err) {
      if (err instanceof MalformedPathError) {
        if (appMiddleware.length > 0) {
          return runChain(malformedUrlEntry, appMiddleware, req, res, next);
        }
        return writer
          .write(malformedUrlResponse(req as FrameworkRequest), req, res)
          .catch(next);
      }
      return next(err);
    }

    if (!result) {
      if (appMiddleware.length > 0) {
        // App-wide middleware wrap the 404 too.
        return runChain(notFoundEntry, appMiddleware, req, res, next);
      }
      // 404 — let downstream Express middleware (notFoundHandler) decide.
      return next();
    }

    if (result.entry === null) {
      // 405 — path matched, method didn't.
      const { allowedMethods } = result;
      if (appMiddleware.length > 0) {
        const notAllowedEntry = answering('methodNotAllowed', (r) =>
          methodNotAllowedResponse(r, allowedMethods),
        );
        return runChain(notAllowedEntry, appMiddleware, req, res, next);
      }
      return writer
        .write(
          methodNotAllowedResponse(req as FrameworkRequest, allowedMethods),
          req,
          res,
        )
        .catch(next);
    }

    // Populate request with match metadata before middleware runs.
    req.params = result.params;
    // Follow Express's registered-template convention. Refresh on a miss for
    // routes added after mounting; ordinary dispatch stays O(1).
    const matchedNode = getMatchedNode(result);
    if (matchedNode && !routeTemplates.has(matchedNode)) {
      indexTemplates();
    }
    req.route = {
      path: matchedNode ? routeTemplates.get(matchedNode) : 'unmatched',
      methods: Object.fromEntries(
        Object.keys(matchedNode?.methods ?? {}).map((method) => [
          method.toLowerCase(),
          true,
        ]),
      ),
    };
    // biome-ignore lint/suspicious/noExplicitAny: routeMeta is a runtime extension on req
    (req as any).routeMeta = {
      bodyParsing: result.bodyParsing,
      ...(result.entry.meta ?? {}),
    };

    const parser = parserFor(result.bodyParsing);
    if (
      appMiddleware.length > 0 ||
      result.entry.contract === 2 ||
      result.middlewares.some(isV2Middleware)
    ) {
      // A strict-onion chain: the body parser, app-wide middleware, then the
      // route's own middleware and handler.
      return runChain(
        result.entry,
        [...(parser ? [parser] : []), ...appMiddleware, ...result.middlewares],
        req,
        res,
        next,
      );
    }

    try {
      // Only 5.x code on the route: parse the body first, then the 5.x dispatch.
      if (parser) {
        await (middlewareInstance(app, parser) as RequestParser).parse(
          expressContext(app, req, res),
        );
      }
      for (const mwEntry of result.middlewares) {
        await runMiddleware(app, mwEntry, req, res);
        // Stop if the response finished (writableEnded) OR the client aborted
        // (destroyed) — no point running the rest of the chain on a dead socket.
        if (res.writableEnded || res.destroyed) {
          return;
        }
      }
      const returned = await Promise.resolve(
        result.entry.handler(req, res, next),
      );
      // Only a branded `HttpResponse` is rendered; any other return value is
      // the legacy `res` style, which has already answered (or will).
      if (HttpResponse.is(returned)) {
        if (res.headersSent) {
          throw new Error(
            `${req.method} ${req.route.path}: the handler both wrote to res and returned an HttpResponse. Use one or the other.`,
          );
        }
        await writer.write(returned, req, res);
      } else if (!res.headersSent) {
        // An override that awaited a framework handler without returning its
        // response would answer nothing (5.x bridge, see `builtInResponse`).
        const dropped = producedBuiltInResponse(req);
        if (dropped) {
          warnDroppedResponse(result.entry);
          await writer.write(dropped, req, res);
        }
      }
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Run one middleware entry and resolve when it either calls `next()`,
 * ends the response, or throws.
 */
function runMiddleware(
  app: IApp,
  entry: MiddlewareEntry,
  req: Request,
  res: Response,
): Promise<void> {
  const instance = middlewareInstance(app, entry);

  return new Promise<void>((resolve, reject) => {
    let resolved = false;
    const settle = (err?: unknown): void => {
      if (resolved) {
        // The middleware already advanced the chain (called `next()` or ended
        // the response), so the flow can't be rewound and the request is not
        // corrupted. A late rejection still means something failed — surface
        // it instead of dropping it silently. A benign late settle (double
        // `next()`, no error) stays quiet.
        if (err) {
          app.logger.error(
            `Middleware ${entry.Class.name} rejected after settling: ${
              err instanceof Error ? (err.stack ?? err.message) : err
            }`,
          );
        }
        return;
      }
      resolved = true;
      res.off('finish', onFinish);
      res.off('close', onClose);
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      } else {
        resolve();
      }
    };
    const onFinish = (): void => settle();
    const onClose = (): void => settle();
    res.once('finish', onFinish);
    res.once('close', onClose);

    // Cast: AbstractMiddleware.middleware expects FrameworkRequest, we
    // pass Express's Request. They're shape-compatible at runtime.
    Promise.resolve(
      // biome-ignore lint/suspicious/noExplicitAny: bridging Express → framework request shape
      (instance as AbstractMiddleware).middleware(req as any, res, settle),
    ).catch(settle);
  });
}
