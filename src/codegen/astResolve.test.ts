/**
 * Tests for the AST extends-walk + inheritance merge (`astResolve.ts`) — the
 * replacement for `importResolution.ts`. Scenarios mirror `emit.test.ts`: own
 * vs inherited middleware, binding≠class-name, bare-package ancestors, and
 * cross-directory specifier rebasing. Fixtures are written to a temp dir; only
 * the `extends`-chain files need to exist on disk (the middleware files don't —
 * the binding/specifier come from the import node, not the live class).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveController } from './astResolve.ts';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ast-resolve-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(rel: string, src: string): Promise<string> {
  const full = path.join(dir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, src, 'utf8');
  return full;
}

describe('astResolve — inheritance', () => {
  it('inherits a relative parent’s middleware + import (same dir)', async () => {
    await write(
      'Parent.ts',
      `import SomeMW from './middleware/SomeMW.js';
export default class Parent extends Base {
  static get middleware() { return new Map([['/{*splat}', [SomeMW]]]); }
}`,
    );
    const child = await write(
      'Child.ts',
      `import Parent from './Parent.ts';
export default class Child extends Parent {
  get routes() { return { get: { '/': this.list } }; }
}`,
    );
    const r = await resolveController(child);
    expect(r.needsBoot).toBe(false);
    expect(r.middleware).toEqual([
      { scope: '/{*splat}', bindings: ['SomeMW'] },
    ]);
    expect(r.imports).toEqual([
      {
        binding: 'SomeMW',
        kind: 'default',
        specifier: './middleware/SomeMW.js',
      },
    ]);
  });

  it('uses the controller’s own middleware over an inherited one', async () => {
    const child = await write(
      'Own.ts',
      `import OwnMW from './OwnMW.js';
export default class Own extends Whatever {
  get routes() { return { get: { '/': this.list } }; }
  static get middleware() { return new Map([['/{*splat}', [OwnMW]]]); }
}`,
    );
    const r = await resolveController(child);
    expect(r.middleware).toEqual([{ scope: '/{*splat}', bindings: ['OwnMW'] }]);
    expect(r.imports).toEqual([
      { binding: 'OwnMW', kind: 'default', specifier: './OwnMW.js' },
    ]);
  });

  it('emits the import BINDING, not the class name (no identity matching)', async () => {
    // `Auth` is the binding; the module default-exports class `AuthMiddleware`.
    // The AST reads the binding directly — the class name never enters into it.
    const child = await write(
      'Guarded.ts',
      `import Auth from './AuthMw.js';
export default class Guarded extends Base {
  get routes() { return { get: { '/': this.list } }; }
  static get middleware() { return new Map([['/{*splat}', [Auth]]]); }
}`,
    );
    const r = await resolveController(child);
    expect(r.imports).toEqual([
      { binding: 'Auth', kind: 'default', specifier: './AuthMw.js' },
    ]);
  });

  it('rebases an inherited import from a parent in another directory', async () => {
    await write(
      'sub/Parent.ts',
      `import SomeMW from '../middleware/SomeMW.js';
export default class Parent extends Base {
  static get middleware() { return new Map([['/{*splat}', [SomeMW]]]); }
}`,
    );
    const child = await write(
      'CrossDir.ts',
      `import Parent from './sub/Parent.ts';
export default class CrossDir extends Parent {
  get routes() { return { get: { '/': this.list } }; }
}`,
    );
    const r = await resolveController(child);
    // Parent imports `../middleware/SomeMW.js` (relative to `sub/`); from the
    // child's gen file one dir up that resolves as `./middleware/SomeMW.js`.
    expect(r.imports).toEqual([
      {
        binding: 'SomeMW',
        kind: 'default',
        specifier: './middleware/SomeMW.js',
      },
    ]);
  });

  it('flags a dynamic routes getter as needsBoot (middleware still resolved)', async () => {
    const child = await write(
      'Dyn.ts',
      `import OwnMW from './OwnMW.js';
export default class Dyn extends Base {
  get routes() { this.logger.warn('x'); return {}; }
  static get middleware() { return new Map([['/{*splat}', [OwnMW]]]); }
}`,
    );
    const r = await resolveController(child);
    expect(r.needsBoot).toBe(true);
    expect(r.reason).toMatch(/routes getter/);
    expect(r.middleware).toEqual([{ scope: '/{*splat}', bindings: ['OwnMW'] }]);
  });
});

describe('astResolve — bare-package ancestor', () => {
  it('rewrites a bare ancestor’s relative imports into bare specifiers', async () => {
    const root = path.join(dir, 'consumer');
    const dist = path.join(root, 'node_modules/@adaptivestone/framework/dist');
    await mkdir(dist, { recursive: true });
    await writeFile(
      path.join(root, 'node_modules/@adaptivestone/framework/package.json'),
      JSON.stringify({
        name: '@adaptivestone/framework',
        type: 'module',
        exports: { './*': './dist/*' },
      }),
      'utf8',
    );
    await mkdir(path.join(dist, 'modules'), { recursive: true });
    await writeFile(
      path.join(dist, 'modules/AbstractController.js'),
      `import Auth from '../services/http/middleware/Auth.js';
import GetUserByToken from '../services/http/middleware/GetUserByToken.js';
export default class AbstractController extends Base {
  static get middleware() { return new Map([['/{*splat}', [GetUserByToken, Auth]]]); }
}`,
      'utf8',
    );
    const consumer = path.join(root, 'Consumer.ts');
    await writeFile(
      consumer,
      `import AbstractController from '@adaptivestone/framework/modules/AbstractController.js';
export default class Consumer extends AbstractController {
  get routes() { return { get: { '/': this.list } }; }
}`,
      'utf8',
    );

    const r = await resolveController(consumer);
    expect(r.middleware).toEqual([
      { scope: '/{*splat}', bindings: ['GetUserByToken', 'Auth'] },
    ]);
    expect(r.imports).toEqual([
      {
        binding: 'GetUserByToken',
        kind: 'default',
        specifier:
          '@adaptivestone/framework/services/http/middleware/GetUserByToken.js',
      },
      {
        binding: 'Auth',
        kind: 'default',
        specifier: '@adaptivestone/framework/services/http/middleware/Auth.js',
      },
    ]);
  });
});
