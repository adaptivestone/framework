/**
 * Unit tests for the pure renderer (`renderGenFile`) — robustness of two things
 * the runtime router accepts but the emitter used to mishandle:
 *   - finding #17: a path param name is the FULL segment after `:`
 *     (`RouteRegistry` does `seg.slice(1)`), so `:order-id` / `:1st` must land in
 *     `req.params` verbatim and the emitted type must key them (quoted when not a
 *     valid TS identifier), not truncate/drop them.
 *   - finding #19: a route path may legally contain `*\/` (only a LEADING `*` is
 *     a splat); interpolated raw into the generated JSDoc block comment it ends
 *     the comment early and the file fails to parse (TS1443/TS1160).
 *
 * These render in-memory (no fixtures, no pipeline), so they don't touch the
 * shared `__fixtures__/*.routes.gen.ts` the golden test writes.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDiagnostics } from './__fixtures__/parseDiagnostics.ts';
import type { RouteMeta } from './collectMetadata.ts';
import { type RenderInput, renderGenFile } from './emit.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

function route(method: string, p: string, handlerName: string): RouteMeta {
  return {
    method,
    path: p,
    handlerName,
    hasSchema: false,
    hasQuerySchema: false,
  };
}

function inputFor(routes: RouteMeta[]): RenderInput {
  return {
    controller: { className: 'Demo', prefix: '', urlPrefix: '/demo', routes },
    srcPath: path.join(here, '__fixtures__/controllers/Demo.ts'),
    filteredChains: routes.map(() => []),
    importMap: new Map(),
    controllerTypeImportable: false,
  };
}

describe('renderGenFile — path-param robustness (finding #17)', () => {
  it('keys the FULL segment the router accepts, quoting non-identifiers', () => {
    const out = renderGenFile(
      inputFor([
        route('put', '/order/:order-id', 'getOrder'),
        route('get', '/x/:1st', 'getFirst'),
      ]),
    );
    // Runtime does `seg.slice(1)`: `order-id` and `1st` reach `req.params`
    // verbatim. Neither is a valid TS identifier → single-quoted keys.
    expect(out).toContain("params: { 'order-id': string }");
    expect(out).toContain("params: { '1st': string }");
    // Sanity: the emitted module still parses (quoting keeps the key valid TS).
    expect(parseDiagnostics(out)).toEqual([]);
  });

  it('leaves valid-identifier params unquoted (byte-identical output)', () => {
    const out = renderGenFile(inputFor([route('get', '/user/:id', 'getUser')]));
    expect(out).toContain('params: { id: string }');
    expect(out).not.toContain("'id'");
  });
});

describe('renderGenFile — JSDoc escaping (finding #19)', () => {
  it('escapes `*/` in a route path so the doc comment stays intact', () => {
    const out = renderGenFile(inputFor([route('get', '/a*/b', 'thing')]));
    // The doc comment renders the escaped form (`*\/`), not a raw `*/`.
    expect(out).toContain('GET /a*\\/b');
    // The whole module parses — an unescaped `*/` ends the comment early.
    expect(parseDiagnostics(out)).toEqual([]);
  });
});
