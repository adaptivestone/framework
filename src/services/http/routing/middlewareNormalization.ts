/**
 * Convert authoring shorthand (`Class` or `[Class, params]`) into
 * canonical `MiddlewareEntry`. The registry stores only canonical form;
 * shorthand exists at the user-authoring boundary.
 */

import type AbstractMiddleware from '../middleware/AbstractMiddleware.ts';
import type { MiddlewareEntry } from './RouteNode.ts';

export type MiddlewareSpec =
  | typeof AbstractMiddleware
  | readonly [typeof AbstractMiddleware, Record<string, unknown>];

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
    return {
      Class: Class as typeof AbstractMiddleware,
      params: params as Record<string, unknown>,
    };
  }
  if (typeof spec !== 'function') {
    throw new TypeError(
      `normalizeMiddleware: expected middleware class or [Class, params] tuple, got ${typeof spec}`,
    );
  }
  return { Class: spec };
}

export function normalizeMiddlewares(
  specs: ReadonlyArray<MiddlewareSpec>,
): MiddlewareEntry[] {
  return specs.map((spec) => normalizeMiddleware(spec));
}
