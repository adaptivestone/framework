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
import { ExpressResponseWriter } from '../ExpressResponseWriter.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import { FRAMEWORK_ERROR_CODES } from '../httpErrors.ts';
import type AbstractMiddleware from '../middleware/AbstractMiddleware.ts';
import type { ResponseWriter } from '../ResponseWriter.ts';
import { HttpResponse } from '../responses.ts';
import { getMatchedNode, MalformedPathError } from './match.ts';
import type {
  HandlerEntry,
  MatchResult,
  MiddlewareEntry,
  RouteNode,
} from './RouteNode.ts';
import type { RouteRegistry } from './RouteRegistry.ts';

const instanceCache = new WeakMap<MiddlewareEntry, AbstractMiddleware>();

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

export function createExpressAdapter(
  registry: RouteRegistry,
  app: IApp,
  writer: ResponseWriter<Request, Response> = new ExpressResponseWriter(),
): ExpressAdapter {
  const routeTemplates = new WeakMap<RouteNode, string>();
  const indexTemplates = () =>
    registry.walk((node, path) => routeTemplates.set(node, path));
  indexTemplates();
  return async function dispatch(req, res, next) {
    let result: MatchResult | null;
    try {
      result = registry.match(req.method, req.path);
    } catch (err) {
      if (err instanceof MalformedPathError) {
        const malformed = HttpResponse.json(400, {
          error: FRAMEWORK_ERROR_CODES.malformedUrl,
          message: translateWithDefault(
            req as FrameworkRequest,
            'http.malformedUrl',
            'Malformed URL',
          ),
        });
        return writer.write(malformed, req, res).catch(next);
      }
      return next(err);
    }

    if (!result) {
      // 404 — let downstream Express middleware (notFoundHandler) decide.
      return next();
    }

    if (result.entry === null) {
      // 405 — path matched, method didn't.
      const notAllowed = HttpResponse.json(
        405,
        {
          error: FRAMEWORK_ERROR_CODES.methodNotAllowed,
          message: translateWithDefault(
            req as FrameworkRequest,
            'http.methodNotAllowed',
            'Method not allowed',
          ),
        },
        { headers: { Allow: result.allowedMethods.join(', ') } },
      );
      return writer.write(notAllowed, req, res).catch(next);
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

    try {
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
  let instance = instanceCache.get(entry);
  if (!instance) {
    // Default params to `{}` — matches legacy `parseMiddlewares` behavior
    // and prevents middlewares that destructure `this.params` from crashing.
    instance = new entry.Class(app, entry.params ?? {});
    instanceCache.set(entry, instance);
  }

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
