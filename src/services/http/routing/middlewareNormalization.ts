/**
 * Convert authoring shorthand (`Class` or `[Class, params]`) into
 * canonical `MiddlewareEntry`. The registry stores only canonical form;
 * shorthand exists at the user-authoring boundary.
 */

import Middleware from '../middleware/Middleware.ts';
import type {
  MiddlewareClass,
  MiddlewareEntry,
  V2MiddlewareClass,
} from './RouteNode.ts';

export type MiddlewareSpec =
  | MiddlewareClass
  | readonly [MiddlewareClass, Record<string, unknown>];

/** Throws `TypeError` on malformed input. */
export function normalizeMiddleware(spec: MiddlewareSpec): MiddlewareEntry {
  if (Array.isArray(spec)) {
    const tuple = spec as readonly unknown[];
    if (tuple.length !== 2) {
      throw new TypeError(
        `normalizeMiddleware: tuple form expected exactly [Class, params] but got ${tuple.length} element(s)`,
      );
    }
    const [Class, params] = tuple;
    if (typeof Class !== 'function') {
      throw new TypeError(
        `normalizeMiddleware: tuple form expected [Class, params] but got [${typeof Class}, …]`,
      );
    }
    if (
      typeof params !== 'object' ||
      params === null ||
      Array.isArray(params)
    ) {
      throw new TypeError(
        `normalizeMiddleware: tuple form expected a params object but got ${params === null ? 'null' : Array.isArray(params) ? 'array' : typeof params}`,
      );
    }
    assertMiddlewareShape(Class as MiddlewareClass);
    return {
      Class: Class as MiddlewareClass,
      params: params as Record<string, unknown>,
    };
  }
  if (typeof spec !== 'function') {
    throw new TypeError(
      `normalizeMiddleware: expected middleware class or [Class, params] tuple, got ${typeof spec}`,
    );
  }
  assertMiddlewareShape(spec);
  return { Class: spec };
}

/**
 * A `Middleware` subclass whose `middleware` still takes `(req, res, next)` —
 * typically a subclass of a built-in written before the built-ins moved to
 * `(ctx, next)` — would get a context where it expects `req`. Fail when the
 * route is registered, naming the fix, instead of at the first request.
 */
export function assertMiddlewareShape(Class: MiddlewareClass): void {
  if (!(Class.prototype instanceof Middleware)) {
    return;
  }
  const method = (Class.prototype as { middleware?: unknown }).middleware;
  if (typeof method === 'function' && method.length >= 3) {
    throw new TypeError(
      `${Class.name || 'A middleware'}.middleware takes (req, res, next), but the class extends Middleware, whose middleware takes (ctx, next). The built-ins (Auth, GetUserByToken, Role, Pagination, …) use (ctx, next) since 5.7: rewrite the override as middleware(ctx, next) (read ctx.appInfo, ctx.header(), ctx.body; return next(); throw instead of next(err)), or extend AbstractMiddleware for a 5.x middleware.`,
    );
  }
}

export function normalizeMiddlewares(
  specs: ReadonlyArray<MiddlewareSpec>,
): MiddlewareEntry[] {
  return specs.map((spec) => normalizeMiddleware(spec));
}

/** An app-wide middleware: a `Middleware` class, or `[Class, params]`. */
export type AppMiddlewareSpec =
  | V2MiddlewareClass
  | readonly [V2MiddlewareClass, Record<string, unknown>];

/**
 * Normalize the `Server` `middleware` option. Only `Middleware` (`ctx, next`)
 * classes are accepted: the list must run without Express. Throws `TypeError`
 * naming the offending entry.
 */
export function normalizeAppMiddlewares(
  specs: ReadonlyArray<AppMiddlewareSpec>,
): MiddlewareEntry[] {
  if (!Array.isArray(specs)) {
    throw new TypeError(
      'Server option `middleware` must be an array of Middleware classes or [Class, params] tuples',
    );
  }
  return specs.map((spec, i) => {
    const entry = normalizeMiddleware(spec as MiddlewareSpec);
    if (!(entry.Class.prototype instanceof Middleware)) {
      throw new TypeError(
        `Server option \`middleware\`[${i}]: ${entry.Class.name || 'the class'} is not a Middleware (ctx, next) class. Extend Middleware from services/http/middleware/Middleware.js; a 5.x AbstractMiddleware can be mounted with app.httpServer.express.use() in bootHttp.`,
      );
    }
    return entry;
  });
}
