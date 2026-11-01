/**
 * Tree-based routing primitives. Types only.
 *
 * Internal segment syntax: `':name'` for single-segment params, `'*name'`
 * for splats. Translation layer converts user-facing path syntax to this
 * shape.
 */

import type { IApp } from '../../../server.ts';
import type { RequestContentTypeMap } from '../../validate/contentType.ts';
import type { StandardSchemaV1 } from '../../validate/types.ts';
import type AbstractMiddleware from '../middleware/AbstractMiddleware.ts';
import type Middleware from '../middleware/Middleware.ts';

/**
 * HTTP methods, upper-case. Single source of truth for the framework;
 * the runtime const + the `HttpMethod` type derive from this one array.
 */
export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Body parsing mode per route. The body parser runs after routing, as the
 * first step of the matched route, so the mode decides what it does:
 *
 * - `'parsed'` (default): Content-Type-aware parsing into `req.body` /
 *   `ctx.body` (json, urlencoded, multipart).
 * - `'raw'`: capture the bytes into `req.rawBody: Buffer` (bounded like a
 *   parsed body) and leave the body unparsed — e.g. signed webhooks.
 * - `'none'`: leave the request stream untouched for the handler to read.
 */
export type BodyParsingMode = 'parsed' | 'raw' | 'none';

/**
 * Canonical middleware shape stored in the registry. The `[Class, params]`
 * tuple shorthand is normalized to this struct at the boundary
 * (`middlewareNormalization.ts`).
 */
/**
 * A v2 middleware class: extends `Middleware` (`(ctx, next)`), constructed
 * like every middleware with `(app, params)`.
 */
export type V2MiddlewareClass = (new (
  app: IApp,
  params?: Record<string, unknown>,
) => Middleware) &
  Omit<typeof Middleware, 'prototype'>;

/** Either middleware contract: `AbstractMiddleware` (5.x) or `Middleware` (v2). */
export type MiddlewareClass = typeof AbstractMiddleware | V2MiddlewareClass;

export interface MiddlewareEntry {
  Class: MiddlewareClass;
  params?: Record<string, unknown>;
}

/**
 * Per-method handler entry. `meta` carries fields codegen uses
 * (`<MethodName>Request` alias) and observability uses (`code.filepath`,
 * `code.function`).
 */
export interface HandlerEntry {
  // biome-ignore lint/complexity/noBannedTypes: handlers are user-provided callables of varying shape
  handler: Function;
  /**
   * @internal Validation + handler without the controller's error catch: errors
   * escape unchanged. Used when the route runs as a v2 (`Middleware`) chain.
   */
  // biome-ignore lint/complexity/noBannedTypes: handlers are user-provided callables of varying shape
  rawHandler?: Function;
  /**
   * @internal Handler contract: `2` takes the `RequestContext` and returns an
   * `HttpResponse` (the declaring controller's `contractVersion`); default `1`.
   */
  contract?: 1 | 2;
  request?: StandardSchemaV1 | RequestContentTypeMap;
  query?: StandardSchemaV1;
  params?: StandardSchemaV1;
  middlewares?: MiddlewareEntry[];
  bodyParsing?: BodyParsingMode;
  paramNames?: string[];
  meta?: {
    methodName?: string;
    controllerClass?: string;
    sourceFile?: string;
    /** Author-supplied `RouteObject.description` — surfaced by the OpenAPI generator. */
    description?: string;
  };
}

/**
 * Tree node. Walked at request time: enter → run middlewares → descend.
 *
 * Specificity is structural: static `children` first, then `paramChild`,
 * then `splatChild`. At most one `paramChild` and one `splatChild` per
 * node. Different HTTP methods may use different param names at the same
 * position — each handler carries its own `paramNames` array.
 */
export interface RouteNode {
  segment: string;
  middlewares: MiddlewareEntry[];
  methods?: Partial<Record<HttpMethod, HandlerEntry>>;
  children: Map<string, RouteNode>;
  paramChild?: RouteNode;
  splatChild?: RouteNode;
  bodyParsing?: BodyParsingMode;
  meta?: {
    sourceFile?: string;
    controllerClass?: string;
  };
}

/**
 * Match outcome:
 * - `entry !== null` → success; adapter runs middlewares then handler.
 * - `entry === null` → the path matched but no matching route has the method
 *   (405); `allowedMethods` lists the methods of every route matching the
 *   path, for the `Allow` header. `middlewares` and `params` come from the most
 *   specific of them — adapter chooses whether to run the middlewares.
 *
 * `match()` returns `null` when nothing matches (404).
 */
export interface MatchResult {
  entry: HandlerEntry | null;
  allowedMethods: HttpMethod[];
  middlewares: MiddlewareEntry[];
  params: Record<string, string>;
  bodyParsing: BodyParsingMode;
}

/** One entry per (method, full-path) leaf — produced by `flatten()`. */
export interface FlatRoute {
  method: HttpMethod;
  path: string;
  entry: HandlerEntry;
  middlewares: MiddlewareEntry[];
  bodyParsing: BodyParsingMode;
}
