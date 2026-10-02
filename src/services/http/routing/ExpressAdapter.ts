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
import type { FrameworkRequest } from '../HttpServer.ts';
import type AbstractMiddleware from '../middleware/AbstractMiddleware.ts';
import { getMatchedNode, MalformedPathError } from './match.ts';
import type { MatchResult, MiddlewareEntry, RouteNode } from './RouteNode.ts';
import type { RouteRegistry } from './RouteRegistry.ts';

const instanceCache = new WeakMap<MiddlewareEntry, AbstractMiddleware>();

export type ExpressAdapter = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

export function createExpressAdapter(
  registry: RouteRegistry,
  app: IApp,
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
        res.status(400).json({
          message: translateWithDefault(
            req as FrameworkRequest,
            'http.malformedUrl',
            'Malformed URL',
          ),
        });
        return;
      }
      return next(err);
    }

    if (!result) {
      // 404 — let downstream Express middleware (notFoundHandler) decide.
      return next();
    }

    if (result.entry === null) {
      // 405 — path matched, method didn't.
      res.setHeader('Allow', result.allowedMethods.join(', '));
      res.status(405).json({
        message: translateWithDefault(
          req as FrameworkRequest,
          'http.methodNotAllowed',
          'Method not allowed',
        ),
      });
      return;
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
      await Promise.resolve(result.entry.handler(req, res, next));
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
