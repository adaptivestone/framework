/**
 * Tests for the oxc AST extractor (`astExtract.ts`). Two halves:
 *
 *  1. Extraction — imports / extends / routes / middleware are read correctly
 *     from literal structures, and non-literal getters report `ok: false` so the
 *     run throws instead of mis-generating (routes & middleware judged
 *     independently).
 *  2. Lexical robustness — the whole class of bugs the regex parser
 *     (`importResolution.ts`) kept producing (commented/regex-literal/ASI imports,
 *     a helper class before the controller) is FREE with a real parser: the
 *     constructs simply aren't class/import nodes, so nothing can mistake them.
 */

import { describe, expect, it } from 'vitest';
import { extractController } from './astExtract.ts';

const extract = (src: string) => extractController(src, 'Ctrl.ts');

describe('astExtract — imports', () => {
  it('collects default / named / aliased / namespace; skips type-only', () => {
    const ex = extract(`import Def from './d.js';
import { Named, Orig as Alias } from './n.js';
import * as NS from './ns.js';
import type { T } from './t.js';
import { type TO } from './n.js';
export default class C extends Def {}
`);
    expect(ex.imports.Def).toEqual({ specifier: './d.js', kind: 'default' });
    expect(ex.imports.Named).toEqual({ specifier: './n.js', kind: 'named' });
    expect(ex.imports.Alias).toEqual({
      specifier: './n.js',
      kind: 'named',
      orig: 'Orig',
    });
    expect(ex.imports.NS).toEqual({ specifier: './ns.js', kind: 'namespace' });
    expect(ex.imports.T).toBeUndefined(); // type-only import
    expect(ex.imports.TO).toBeUndefined(); // inline type-only specifier
  });
});

describe('astExtract — exported class + extends', () => {
  it('resolves `export default class X extends Y`', () => {
    const ex = extract('export default class Ctrl extends Base {}');
    expect(ex.className).toBe('Ctrl');
    expect(ex.extendsName).toBe('Base');
  });

  it('resolves `class X extends Y {}` then `export default X`', () => {
    const ex = extract('class Ctrl extends Base {}\nexport default Ctrl;');
    expect(ex.extendsName).toBe('Base');
  });

  it('resolves `export class X extends Y`', () => {
    const ex = extract('export class Ctrl extends Base {}');
    expect(ex.extendsName).toBe('Base');
  });

  it('returns null when the exported class has no extends', () => {
    const ex = extract('export default class Ctrl {}');
    expect(ex.extendsName).toBeNull();
  });

  it('follows the EXPORTED class, not a helper declared first', () => {
    const ex = extract(`class Helper extends Wrong {}
export default class Ctrl extends Right {}`);
    expect(ex.extendsName).toBe('Right');
  });

  it('follows `export { Ctrl as default }`, not a trailing helper class', () => {
    const ex = extract(`class Ctrl extends Right {}
class Helper extends Wrong {}
export { Ctrl as default };`);
    expect(ex.className).toBe('Ctrl');
    expect(ex.extendsName).toBe('Right');
  });

  it('follows the string-literal form `export { Ctrl as "default" }` (ES2022)', () => {
    const ex = extract(`class Ctrl extends Right {}
class Helper extends Wrong {}
export { Ctrl as "default" };`);
    expect(ex.className).toBe('Ctrl');
    expect(ex.extendsName).toBe('Right');
  });

  it('returns null for a qualified / mixin parent (documented residual)', () => {
    expect(
      extract('export default class C extends ns.Base {}').extendsName,
    ).toBeNull();
    expect(
      extract('export default class C extends mixin(Base) {}').extendsName,
    ).toBeNull();
  });
});

describe('astExtract — routes', () => {
  it('reads bare-handler, request, and query route entries', () => {
    const ex = extract(`export default class C extends B {
  get routes() {
    return {
      post: {
        '/login': { handler: this.login, request: schema() },
        '/logout': this.logout,
      },
      get: { '/list': { handler: this.list, query: q() } },
    };
  }
}`);
    expect(ex.ok).toBe(true);
    expect(ex.routes).toEqual([
      {
        method: 'post',
        path: '/login',
        handler: 'login',
        hasRequest: true,
        hasQuery: false,
      },
      {
        method: 'post',
        path: '/logout',
        handler: 'logout',
        hasRequest: false,
        hasQuery: false,
      },
      {
        method: 'get',
        path: '/list',
        handler: 'list',
        hasRequest: false,
        hasQuery: true,
      },
    ]);
  });

  it('extracts a content-type request map’s media-type keys', () => {
    const ex = extract(`export default class C extends B {
  get routes() {
    return {
      post: { '/up': { handler: this.up, request: { 'application/json': s(), 'multipart/form-data': s() } } },
    };
  }
}`);
    expect(ex.ok).toBe(true);
    expect(ex.routes[0]?.hasRequest).toBe(true);
    expect(ex.routes[0]?.requestContentTypes).toEqual([
      'application/json',
      'multipart/form-data',
    ]);
  });

  it('extracts route-level middleware bindings', () => {
    const ex = extract(`export default class C extends B {
  get routes() { return { get: { '/': { handler: this.r, middleware: [Mw, [Other, { x: 1 }]] } } }; }
}`);
    expect(ex.ok).toBe(true);
    expect(ex.routes[0]?.middleware).toEqual(['Mw', 'Other']);
  });

  it('keeps a single-schema (non-content-type) object request without media types', () => {
    const ex = extract(`export default class C extends B {
  get routes() { return { post: { '/x': { handler: this.x, request: { a: s() } } } }; }
}`);
    expect(ex.ok).toBe(true);
    expect(ex.routes[0]?.hasRequest).toBe(true);
    expect(ex.routes[0]?.requestContentTypes).toBeUndefined();
  });

  it('flags a request map with computed keys as unanalyzable', () => {
    const ex = extract(`export default class C extends B {
  get routes() { return { post: { '/x': { handler: this.x, request: { [k]: s() } } } }; }
}`);
    expect(ex.ok).toBe(false);
    expect(ex.reason).toMatch(/computed\/spread/);
  });

  it('rejects a route with no identifiable handler (shorthand / optional chain / absent)', () => {
    // Each of these would otherwise yield handler:null and be silently dropped at emit.
    for (const entry of [
      '{ handler }', // object shorthand
      '{ handler: this?.x }', // optional-chain member (ChainExpression)
      '{ request: s() }', // no handler key at all
      'this?.x', // bare optional-chain handler
    ]) {
      const ex = extract(`export default class C extends B {
  get routes() { return { get: { '/x': ${entry} } }; }
}`);
      expect(ex.ok, entry).toBe(false);
      expect(ex.reason, entry).toMatch(/no identifiable handler/);
    }
  });

  it('rejects a spread route entry (a spread can hide handler/request/middleware)', () => {
    const ex = extract(`export default class C extends B {
  get routes() { return { get: { '/x': { ...defaults, handler: this.x } } }; }
}`);
    expect(ex.ok).toBe(false);
    expect(ex.reason).toMatch(/spread in the route entry/);
  });

  it('flags a dynamic routes getter as needsBoot but still extracts middleware', () => {
    // The base AbstractController shape: a non-literal `routes`, a literal Map.
    const ex = extract(`export default class C extends B {
  get routes() {
    this.logger.warn('implement me');
    return {};
  }
  static get middleware() {
    return new Map([['/{*splat}', [Mw]]]);
  }
}`);
    expect(ex.ok).toBe(false);
    expect(ex.reason).toMatch(/routes getter not a literal/);
    expect(ex.middleware).toEqual([{ scope: '/{*splat}', bindings: ['Mw'] }]);
  });
});

describe('astExtract — middleware', () => {
  it('reads a literal Map of scope → binding names', () => {
    const ex = extract(`export default class C extends B {
  static get middleware() {
    return new Map([['/{*splat}', [GetUserByToken, Auth]], ['POST/', [RateLimiter]]]);
  }
}`);
    expect(ex.middleware).toEqual([
      { scope: '/{*splat}', bindings: ['GetUserByToken', 'Auth'] },
      { scope: 'POST/', bindings: ['RateLimiter'] },
    ]);
  });

  it('reads `new Map()` as an empty (declarative) map', () => {
    const ex = extract(`export default class C extends B {
  static get middleware() { return new Map(); }
}`);
    expect(ex.ok).toBe(true);
    expect(ex.middleware).toEqual([]);
  });

  it('reads a `[Mw, params]` tuple as its binding', () => {
    const ex = extract(`export default class C extends B {
  static get middleware() { return new Map([['/{*splat}', [[RateLimiter, { max: 5 }]]]]); }
}`);
    expect(ex.middleware).toEqual([
      { scope: '/{*splat}', bindings: ['RateLimiter'] },
    ]);
  });

  it('leaves middleware undefined when none is declared (inherits)', () => {
    const ex = extract(
      'export default class C extends B { get routes() { return {}; } }',
    );
    expect(ex.ok).toBe(true);
    expect(ex.middleware).toBeUndefined();
    // No getter here → NOT dynamic (so the walk keeps inheriting from above).
    expect(ex.middlewareDynamic).toBe(false);
  });

  it('flags a dynamic middleware getter as needsBoot + sets middlewareDynamic', () => {
    const ex = extract(`export default class C extends B {
  static get middleware() { return buildMap(); }
}`);
    expect(ex.ok).toBe(false);
    expect(ex.reason).toMatch(/middleware getter not a literal Map/);
    // The flag lets the extends-walk tell "non-literal getter here" apart from
    // "no getter here" (which inherits) — see astResolve's ancestor handling.
    expect(ex.middlewareDynamic).toBe(true);
  });
});

describe('astExtract — lexical robustness (free with a real parser)', () => {
  it('a regex literal resembling a class declaration cannot poison extends', () => {
    const ex = extract(`import Right from './r.js';
const re = /export default class Z extends Wrong/;
export default class Ctrl extends Right {}`);
    expect(ex.extendsName).toBe('Right');
  });

  it('a commented-out import never enters the import map', () => {
    const ex = extract(`import Real from './real.js';
// import Decoy from './decoy.js';
/** @example import Decoy from './jsdoc.js'; */
export default class Ctrl extends Real {}`);
    expect(ex.imports.Real).toBeDefined();
    expect(ex.imports.Decoy).toBeUndefined();
  });

  it('semicolon-less (ASI) imports are all parsed', () => {
    const ex = extract(`import A from './a.js'
import B from './b.js'
export default class Ctrl extends A {}`);
    expect(ex.imports.A?.specifier).toBe('./a.js');
    expect(ex.imports.B?.specifier).toBe('./b.js');
  });
});
