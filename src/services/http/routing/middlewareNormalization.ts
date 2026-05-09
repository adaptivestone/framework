/**
 * Convert authoring shorthand (`Class` or `[Class, params]`) into
 * canonical `MiddlewareEntry`. The registry stores only canonical form;
 * shorthand exists at the user-authoring boundary.
 *
 * `source` is caller-supplied — class references carry no import-path
 * info at runtime. Convention:
 *   - `{ kind: 'package', spec: 'pkg/sub/path' }` for npm imports
 *   - `{ kind: 'file',    spec: 'src/middleware/My.ts' }` for project files
 */

import type AbstractMiddleware from '../middleware/AbstractMiddleware.ts';
import type { MiddlewareEntry } from './RouteNode.ts';

export type MiddlewareSpec =
  | typeof AbstractMiddleware
  | readonly [typeof AbstractMiddleware, Record<string, unknown>];

/** Throws `TypeError` on malformed input. */
export function normalizeMiddleware(
  spec: MiddlewareSpec,
  source: MiddlewareEntry['source'],
): MiddlewareEntry {
  if (Array.isArray(spec)) {
    const [Class, params] = spec as [
      typeof AbstractMiddleware,
      Record<string, unknown>,
    ];
    if (typeof Class !== 'function') {
      throw new TypeError(
        `normalizeMiddleware: tuple form expected [Class, params] but got [${typeof Class}, …]`,
      );
    }
    return { Class, params, source };
  }
  if (typeof spec !== 'function') {
    throw new TypeError(
      `normalizeMiddleware: expected middleware class or [Class, params] tuple, got ${typeof spec}`,
    );
  }
  return { Class: spec, source };
}

export function normalizeMiddlewares(
  specs: ReadonlyArray<MiddlewareSpec>,
  source: MiddlewareEntry['source'],
): MiddlewareEntry[] {
  return specs.map((spec) => normalizeMiddleware(spec, source));
}
