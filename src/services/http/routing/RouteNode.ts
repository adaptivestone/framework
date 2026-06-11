/**
 * Tree-based routing primitives. Types only.
 *
 * Internal segment syntax: `':name'` for single-segment params, `'*name'`
 * for splats. Translation layer converts user-facing path syntax to this
 * shape.
 */

import type { RequestContentTypeMap } from '../../validate/contentType.ts';
import type { StandardSchemaV1 } from '../../validate/types.ts';
import type AbstractMiddleware from '../middleware/AbstractMiddleware.ts';

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
 * Body parsing mode per route.
 *
 * - `'parsed'` (default): Content-Type-aware parser dispatch. **The only mode
 *   that takes effect today.**
 *
 * `'raw'` and `'none'` are **reserved and not yet implemented** (planned for
 * v5.1). The matcher resolves and propagates the mode, but the request pipeline
 * does not act on it: `RequestParser` is mounted globally, so every body is
 * parsed regardless — `req.rawBody` is never set and the stream is always
 * consumed. Do not rely on them until v5.1 (the parser-registry design lives in
 * the refactor plans).
 *
 * - `'raw'` *(v5.1)*: capture bytes into `req.rawBody: Buffer`, skip parsing.
 * - `'none'` *(v5.1)*: pass-through, leave the request stream untouched.
 */
export type BodyParsingMode = 'parsed' | 'raw' | 'none';

/**
 * Canonical middleware shape stored in the registry. The `[Class, params]`
 * tuple shorthand is normalized to this struct at the boundary
 * (`middlewareNormalization.ts`).
 */
export interface MiddlewareEntry {
  Class: typeof AbstractMiddleware;
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
  request?: StandardSchemaV1 | RequestContentTypeMap;
  query?: StandardSchemaV1;
  middlewares?: MiddlewareEntry[];
  bodyParsing?: BodyParsingMode;
  paramNames?: string[];
  meta?: {
    methodName?: string;
    controllerClass?: string;
    sourceFile?: string;
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
 * - `entry === null` → path matched a node but the method didn't (405);
 *   adapter sets `Allow: <allowedMethods>`. `middlewares` still holds the
 *   accumulated path chain — adapter chooses whether to run them.
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
