import type { IApp } from '../../../server.ts';
import type AbstractMiddleware from './AbstractMiddleware.ts';

/**
 * One entry in the middleware-info list built by
 * `AbstractController.parseMiddlewares`. Used to look up the schemas a
 * middleware declares for a given route+method+prefix.
 */
export interface MiddlewareInfo {
  method: string;
  fullPath: string;
  params: Record<string, unknown>;
  MiddlewareFunction: new (
    app: IApp,
    params: Record<string, unknown>,
  ) => AbstractMiddleware;
}

/**
 * Collect schemas that middlewares attached to a route declare via
 * `relatedRequestParameters` / `relatedQueryParameters`.
 *
 * Walks the controller-level + route-level middleware info, filters by
 * `(method, fullPath)`, instantiates each middleware (cheap), reads the
 * matching prefix's schema, and returns a flat array.
 *
 * Null entries are filtered — middlewares that don't declare a schema
 * for the given prefix are skipped.
 */
export function collectMiddlewareSchemas(
  app: IApp,
  controllerMiddlewares: MiddlewareInfo[],
  routeMiddlewares: MiddlewareInfo[],
  method: string,
  fullPath: string,
  prefix: 'request' | 'query',
): unknown[] {
  const lower = (s: string) => s.toLowerCase();
  const m = lower(method);
  const p = lower(fullPath);

  const schemas: unknown[] = [];
  for (const mw of [...controllerMiddlewares, ...routeMiddlewares]) {
    if (lower(mw.method) !== m || lower(mw.fullPath) !== p) {
      continue;
    }
    const instance = new mw.MiddlewareFunction(app, mw.params);
    const schema = instance.relatedReqParameters?.[prefix];
    if (schema) {
      schemas.push(schema);
    }
  }
  return schemas;
}
