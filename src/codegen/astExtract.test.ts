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

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertTextMatch } from '../tests/assertions.ts';
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
    assert.deepStrictEqual(ex.imports.Def, {
      specifier: './d.js',
      kind: 'default',
    });
    assert.deepStrictEqual(ex.imports.Named, {
      specifier: './n.js',
      kind: 'named',
    });
    assert.deepStrictEqual(ex.imports.Alias, {
      specifier: './n.js',
      kind: 'named',
      orig: 'Orig',
    });
    assert.deepStrictEqual(ex.imports.NS, {
      specifier: './ns.js',
      kind: 'namespace',
    });
    assert.strictEqual(ex.imports.T, undefined); // type-only import
    assert.strictEqual(ex.imports.TO, undefined); // inline type-only specifier
  });
});

describe('astExtract — exported class + extends', () => {
  it('resolves `export default class X extends Y`', () => {
    const ex = extract('export default class Ctrl extends Base {}');
    assert.strictEqual(ex.className, 'Ctrl');
    assert.strictEqual(ex.extendsName, 'Base');
  });

  it('resolves `class X extends Y {}` then `export default X`', () => {
    const ex = extract('class Ctrl extends Base {}\nexport default Ctrl;');
    assert.strictEqual(ex.extendsName, 'Base');
  });

  it('resolves `export class X extends Y`', () => {
    const ex = extract('export class Ctrl extends Base {}');
    assert.strictEqual(ex.extendsName, 'Base');
  });

  it('returns null when the exported class has no extends', () => {
    const ex = extract('export default class Ctrl {}');
    assert.strictEqual(ex.extendsName, null);
  });

  it('follows the EXPORTED class, not a helper declared first', () => {
    const ex = extract(`class Helper extends Wrong {}
export default class Ctrl extends Right {}`);
    assert.strictEqual(ex.extendsName, 'Right');
  });

  it('follows `export { Ctrl as default }`, not a trailing helper class', () => {
    const ex = extract(`class Ctrl extends Right {}
class Helper extends Wrong {}
export { Ctrl as default };`);
    assert.strictEqual(ex.className, 'Ctrl');
    assert.strictEqual(ex.extendsName, 'Right');
  });

  it('follows the string-literal form `export { Ctrl as "default" }` (ES2022)', () => {
    const ex = extract(`class Ctrl extends Right {}
class Helper extends Wrong {}
export { Ctrl as "default" };`);
    assert.strictEqual(ex.className, 'Ctrl');
    assert.strictEqual(ex.extendsName, 'Right');
  });

  it('returns null for a qualified / mixin parent (documented residual)', () => {
    assert.strictEqual(
      extract('export default class C extends ns.Base {}').extendsName,
      null,
    );
    assert.strictEqual(
      extract('export default class C extends mixin(Base) {}').extendsName,
      null,
    );
  });
});

describe('astExtract — routes', () => {
  it('sees through `as const` / `satisfies` / parens on the routes getter', () => {
    // These TS-only wrappers don't change the runtime value, so a declarative
    // `return { … } as const` must still be extracted — not rejected as
    // non-literal (which would abort codegen for the whole project).
    for (const wrap of ['as const', 'satisfies Record<string, unknown>']) {
      const ex = extract(`export default class C extends B {
  get routes() { return { get: { '/ping': this.ping } } ${wrap}; }
}`);
      assert.strictEqual(ex.ok, true, wrap);
      assert.deepStrictEqual(
        ex.routes.map((r) => r.path),
        ['/ping'],
      );
    }
    const paren = extract(`export default class C extends B {
  get routes() { return ({ get: { '/ping': this.ping } }); }
}`);
    assert.strictEqual(paren.ok, true);
    assert.deepStrictEqual(
      paren.routes.map((r) => r.path),
      ['/ping'],
    );
  });

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
    assert.strictEqual(ex.ok, true);
    assert.deepStrictEqual(ex.routes, [
      {
        method: 'post',
        path: '/login',
        handler: 'login',
        hasRequest: true,
        hasQuery: false,
        hasParams: false,
      },
      {
        method: 'post',
        path: '/logout',
        handler: 'logout',
        hasRequest: false,
        hasQuery: false,
        hasParams: false,
      },
      {
        method: 'get',
        path: '/list',
        handler: 'list',
        hasRequest: false,
        hasQuery: true,
        hasParams: false,
      },
    ]);
  });

  it('flags a route-level params schema, ignoring an explicit nullish one', () => {
    const ex = extract(`export default class C extends B {
  get routes() {
    return {
      get: {
        '/typed/:n': { handler: this.typed, params: p() },
        '/nulled/:n': { handler: this.nulled, params: null },
        '/undef/:n': { handler: this.undef, params: undefined },
        '/bare/:n': { handler: this.bare },
      },
    };
  }
}`);
    assert.strictEqual(ex.ok, true);
    assert.deepStrictEqual(
      ex.routes.map((r) => [r.path, r.hasParams]),
      [
        ['/typed/:n', true],
        // An explicit nullish schema is skipped by the runtime, so codegen must
        // not emit `InferOutput<null | undefined>` for it either.
        ['/nulled/:n', false],
        ['/undef/:n', false],
        ['/bare/:n', false],
      ],
    );
  });

  it('extracts a content-type request map’s media-type keys', () => {
    const ex = extract(`export default class C extends B {
  get routes() {
    return {
      post: { '/up': { handler: this.up, request: { 'application/json': s(), 'multipart/form-data': s() } } },
    };
  }
}`);
    assert.strictEqual(ex.ok, true);
    assert.strictEqual(ex.routes[0]?.hasRequest, true);
    assert.deepStrictEqual(ex.routes[0]?.requestContentTypes, [
      'application/json',
      'multipart/form-data',
    ]);
  });

  it('extracts route-level middleware bindings', () => {
    const ex = extract(`export default class C extends B {
  get routes() { return { get: { '/': { handler: this.r, middleware: [Mw, [Other, { x: 1 }]] } } }; }
}`);
    assert.strictEqual(ex.ok, true);
    assert.deepStrictEqual(ex.routes[0]?.middleware, ['Mw', 'Other']);
  });

  it('allows initialized const config reads before a literal route return', () => {
    const ex = extract(`export default class C extends B {
  get routes() {
    const { policy } = this.app.getConfig('rateLimiter');
    return {
      post: {
        '/': {
          handler: this.create,
          middleware: [[RateLimiter, policy.personCreate] as const],
        },
      },
    };
  }
}`);

    assert.strictEqual(ex.ok, true);
    assert.deepStrictEqual(ex.routes, [
      {
        method: 'post',
        path: '/',
        handler: 'create',
        hasRequest: false,
        hasQuery: false,
        hasParams: false,
        middleware: ['RateLimiter'],
      },
    ]);
  });

  it('still rejects mutable setup before a literal route return', () => {
    const ex = extract(`export default class C extends B {
  get routes() {
    let policy = this.app.getConfig('rateLimiter').policy;
    return { post: { '/': this.create } };
  }
}`);

    assert.strictEqual(ex.ok, false);
    assertTextMatch(ex.reason, /optional `const` setup/);
  });

  it('still rejects non-const setup statements before a literal route return', () => {
    const setups = [
      "this.app.getConfig('rateLimiter');",
      "if (this.app) { console.log('x'); }",
      'return { post: {} }; const late = 1;',
    ];
    for (const setup of setups) {
      const ex = extract(`export default class C extends B {
  get routes() {
    ${setup}
    return { post: { '/': this.create } };
  }
}`);
      assert.strictEqual(ex.ok, false, setup);
      assertTextMatch(ex.reason, /optional `const` setup/, setup);
    }
  });

  it('sees through TS-only wrappers around route middleware arrays and tuples', () => {
    const forms = [
      '[Auth]',
      '[[RateLimiter, { points: 10 }]]',
      '[[RateLimiter, { points: 10 }] as const]',
      '[[RateLimiter, { points: 10 }]] as const',
      '[([RateLimiter, { points: 10 }] as const)]',
      '[[(RateLimiter as typeof RateLimiter), { points: 10 }] as const]',
    ];
    for (const middleware of forms) {
      const ex = extract(`export default class C extends B {
  get routes() {
    return { post: { '/message': { handler: this.message, middleware: ${middleware} } } };
  }
}`);
      assert.strictEqual(
        ex.ok,
        true,
        `${middleware}: ${ex.reason ?? 'no extraction error'}`,
      );
      assert.deepStrictEqual(
        ex.routes[0]?.middleware,
        [middleware === '[Auth]' ? 'Auth' : 'RateLimiter'],
        middleware,
      );
    }
  });

  it('still rejects dynamically constructed route middleware', () => {
    for (const middleware of ['buildMiddleware()', '[buildMiddleware()]']) {
      const ex = extract(`export default class C extends B {
  get routes() { return { get: { '/': { handler: this.r, middleware: ${middleware} } } }; }
}`);
      assert.strictEqual(ex.ok, false, middleware);
      assertTextMatch(
        ex.reason,
        /unanalyzable route-level middleware/,
        middleware,
      );
    }
  });

  it('keeps a single-schema (non-content-type) object request without media types', () => {
    const ex = extract(`export default class C extends B {
  get routes() { return { post: { '/x': { handler: this.x, request: { a: s() } } } }; }
}`);
    assert.strictEqual(ex.ok, true);
    assert.strictEqual(ex.routes[0]?.hasRequest, true);
    assert.strictEqual(ex.routes[0]?.requestContentTypes, undefined);
  });

  it('flags a request map with computed keys as unanalyzable', () => {
    const ex = extract(`export default class C extends B {
  get routes() { return { post: { '/x': { handler: this.x, request: { [k]: s() } } } }; }
}`);
    assert.strictEqual(ex.ok, false);
    assertTextMatch(ex.reason, /computed\/spread/);
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
      assert.strictEqual(ex.ok, false, entry);
      assertTextMatch(ex.reason, /no identifiable handler/, entry);
    }
  });

  it('rejects a spread route entry (a spread can hide handler/request/middleware)', () => {
    const ex = extract(`export default class C extends B {
  get routes() { return { get: { '/x': { ...defaults, handler: this.x } } }; }
}`);
    assert.strictEqual(ex.ok, false);
    assertTextMatch(ex.reason, /spread in the route entry/);
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
    assert.strictEqual(ex.ok, false);
    assertTextMatch(ex.reason, /routes getter not a literal/);
    assert.deepStrictEqual(ex.middleware, [
      { scope: '/{*splat}', bindings: ['Mw'] },
    ]);
  });
});

describe('astExtract — middleware', () => {
  it('reads a literal Map of scope → binding names', () => {
    const ex = extract(`export default class C extends B {
  static get middleware() {
    return new Map([['/{*splat}', [GetUserByToken, Auth]], ['POST/', [RateLimiter]]]);
  }
}`);
    assert.deepStrictEqual(ex.middleware, [
      { scope: '/{*splat}', bindings: ['GetUserByToken', 'Auth'] },
      { scope: 'POST/', bindings: ['RateLimiter'] },
    ]);
  });

  it('reads `new Map()` as an empty (declarative) map', () => {
    const ex = extract(`export default class C extends B {
  static get middleware() { return new Map(); }
}`);
    assert.strictEqual(ex.ok, true);
    assert.deepStrictEqual(ex.middleware, []);
  });

  it('reads a `[Mw, params]` tuple as its binding', () => {
    const ex = extract(`export default class C extends B {
  static get middleware() { return new Map([['/{*splat}', [[RateLimiter, { max: 5 }]]]]); }
}`);
    assert.deepStrictEqual(ex.middleware, [
      { scope: '/{*splat}', bindings: ['RateLimiter'] },
    ]);
  });

  it('sees through TS-only wrappers in a static middleware Map', () => {
    const ex = extract(`export default class C extends B {
  static get middleware() {
    return new Map(([
      (['/{*splat}', ([
        Auth,
        ([RateLimiter, { points: 20 }] as const),
        [(Other as typeof Other), { enabled: true }],
      ] as const)] as const),
    ] as const));
  }
}`);
    assert.strictEqual(ex.ok, true);
    assert.deepStrictEqual(ex.middleware, [
      {
        scope: '/{*splat}',
        bindings: ['Auth', 'RateLimiter', 'Other'],
      },
    ]);
  });

  it('still rejects dynamically constructed static middleware', () => {
    const forms = [
      {
        list: 'buildMiddleware()',
        reason: /middleware list not an array literal/,
      },
      {
        list: '[buildMiddleware()]',
        reason: /middleware entry not a binding identifier/,
      },
    ];
    for (const { list, reason } of forms) {
      const ex = extract(`export default class C extends B {
  static get middleware() { return new Map([['/', ${list}]]); }
}`);
      assert.strictEqual(ex.ok, false, list);
      assertTextMatch(ex.reason, reason, list);
    }
  });

  it('leaves middleware undefined when none is declared (inherits)', () => {
    const ex = extract(
      'export default class C extends B { get routes() { return {}; } }',
    );
    assert.strictEqual(ex.ok, true);
    assert.strictEqual(ex.middleware, undefined);
    // No getter here → NOT dynamic (so the walk keeps inheriting from above).
    assert.strictEqual(ex.middlewareDynamic, false);
  });

  it('flags a dynamic middleware getter as needsBoot + sets middlewareDynamic', () => {
    const ex = extract(`export default class C extends B {
  static get middleware() { return buildMap(); }
}`);
    assert.strictEqual(ex.ok, false);
    assertTextMatch(ex.reason, /middleware getter not a literal Map/);
    // The flag lets the extends-walk tell "non-literal getter here" apart from
    // "no getter here" (which inherits) — see astResolve's ancestor handling.
    assert.strictEqual(ex.middlewareDynamic, true);
  });
});

describe('astExtract — lexical robustness (free with a real parser)', () => {
  it('a regex literal resembling a class declaration cannot poison extends', () => {
    const ex = extract(`import Right from './r.js';
const re = /export default class Z extends Wrong/;
export default class Ctrl extends Right {}`);
    assert.strictEqual(ex.extendsName, 'Right');
  });

  it('a commented-out import never enters the import map', () => {
    const ex = extract(`import Real from './real.js';
// import Decoy from './decoy.js';
/** @example import Decoy from './jsdoc.js'; */
export default class Ctrl extends Real {}`);
    assert.notStrictEqual(ex.imports.Real, undefined);
    assert.strictEqual(ex.imports.Decoy, undefined);
  });

  it('semicolon-less (ASI) imports are all parsed', () => {
    const ex = extract(`import A from './a.js'
import B from './b.js'
export default class Ctrl extends A {}`);
    assert.strictEqual(ex.imports.A?.specifier, './a.js');
    assert.strictEqual(ex.imports.B?.specifier, './b.js');
  });
});

describe('astExtract — silent-wrong-type guards (doc 07)', () => {
  it('rejects an unknown HTTP verb', () => {
    const ex = extract(
      `export default class Ctrl { get routes() { return { gett: { '/x': this.h } }; } }`,
    );
    assert.strictEqual(ex.ok, false);
    assert.ok(ex.reason.includes('unknown HTTP verb "gett"'));
  });

  it('treats `request: null` as no schema (not InferOutput<null>)', () => {
    const ex = extract(
      `export default class Ctrl { get routes() { return { post: { '/x': { handler: this.h, request: null } } }; } }`,
    );
    assert.strictEqual(ex.ok, true);
    assert.strictEqual(ex.routes[0]?.hasRequest, false);
  });

  it('dedupes duplicate route keys last-wins (no duplicate push)', () => {
    const ex = extract(
      `export default class Ctrl { get routes() { return { get: { '/x': { handler: this.first }, '/x': { handler: this.second } } }; } }`,
    );
    assert.strictEqual(ex.ok, true);
    assert.strictEqual(ex.routes.length, 1);
    assert.strictEqual(ex.routes[0]?.handler, 'second');
  });

  it('records local class declarations and their export status', () => {
    const ex = extract(
      `class LocalMw {}
export class ExportedMw {}
export default class Ctrl { get routes() { return { get: { '/': this.h } }; } }`,
    );
    assert.strictEqual(ex.localClasses.LocalMw, false);
    assert.strictEqual(ex.localClasses.ExportedMw, true);
    assert.strictEqual(ex.localClasses.Ctrl, true);
  });
});
