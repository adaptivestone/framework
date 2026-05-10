/**
 * Tree-based routing primitives. Types only.
 *
 * Internal segment syntax: `':name'` for single-segment params, `'*name'`
 * for splats. Translation layer converts user-facing path syntax to this
 * shape.
 */

import type { StandardSchemaV1 } from '../../validate/types.ts';
import type AbstractMiddleware from '../middleware/AbstractMiddleware.ts';

/** HTTP methods, upper-case. */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

/**
 * Body parsing mode per route.
 * - `'parsed'` (default): Content-Type-aware parser dispatch.
 * - `'raw'`: capture bytes into `req.rawBody: Buffer`, skip parsing.
 * - `'none'`: pass-through, leave the request stream untouched.
 */
export type BodyParsingMode = 'parsed' | 'raw' | 'none';

/**
 * Canonical middleware shape stored in the registry. The `[Class, params]`
 * tuple shorthand is normalized to this struct at the boundary
 * (`middlewareNormalization.ts`).
 *
 * `source` carries import-path info so codegen can emit the right import
 * without scanning controller source.
 */
export interface MiddlewareEntry {
  Class: typeof AbstractMiddleware;
  params?: Record<string, unknown>;
  source: { kind: 'package' | 'file'; spec: string };
}

/**
 * Per-method handler entry. `meta` carries fields codegen uses
 * (`<MethodName>Request` alias) and observability uses (`code.filepath`,
 * `code.function`).
 */
export interface HandlerEntry {
  // biome-ignore lint/complexity/noBannedTypes: handlers are user-provided callables of varying shape
  handler: Function;
  request?: StandardSchemaV1;
  query?: StandardSchemaV1;
  middlewares?: MiddlewareEntry[];
  bodyParsing?: BodyParsingMode;
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
 * node — registering a second of either throws.
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
