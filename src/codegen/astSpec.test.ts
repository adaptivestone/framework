/**
 * Integration test for the AST→spec adapter (`astSpec.ts`): a controller's
 * parsed source becomes a `ControllerSubtreeSpec`, feeds the SHARED
 * `buildSubtreeFromSpec`, and flows through the real `RouteRegistry.flatten()` —
 * proving the AST path reproduces the middleware chain through the same resolver
 * the runtime uses, with synthetic stubs carrying the binding names.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSubtreeFromSpec } from '../controllers/index.ts';
import type { FlatRoute } from '../services/http/routing/RouteNode.ts';
import { RouteRegistry } from '../services/http/routing/RouteRegistry.ts';
import { specFromExtracted } from './astSpec.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, '__fixtures__/controllers');

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ast-spec-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** All middleware-class names across the flattened routes (per the registry). */
function chainNames(flat: FlatRoute[]): string[] {
  return flat.flatMap((fr) => fr.middlewares.map((m) => m.Class.name));
}

/** Build a single-controller registry from an AST spec and flatten it. */
async function flattenOne(srcPath: string, urlPrefix: string) {
  const { spec, resolved } = await specFromExtracted(srcPath);
  const registry = new RouteRegistry();
  registry.registerSubtree(urlPrefix, buildSubtreeFromSpec(spec));
  return { flat: registry.flatten(), resolved };
}

describe('astSpec — AST → spec → flatten', () => {
  it('reproduces a controller’s own middleware chain through the real registry', async () => {
    const file = path.join(dir, 'Own.ts');
    await writeFile(
      file,
      `import GetUserByToken from './gubt.js';
import Auth from './auth.js';
export default class Own extends Base {
  get routes() { return { post: { '/': { handler: this.create } } }; }
  static get middleware() { return new Map([['/{*splat}', [GetUserByToken, Auth]]]); }
}`,
      'utf8',
    );
    const { flat } = await flattenOne(file, '/own');
    expect(chainNames(flat)).toEqual(['GetUserByToken', 'Auth']);
  });

  it('reproduces the chain + emittable imports for the real `File` fixture', async () => {
    const { flat, resolved } = await flattenOne(
      path.join(fixtures, 'File.ts'),
      '/file',
    );
    expect(chainNames(flat)).toEqual(['GetUserByToken', 'Auth']);
    // The emittable imports come straight from the AST (binding → specifier),
    // no live class / identity matching. `Auth` is the binding (the module
    // default-exports `AuthMiddleware`).
    expect(resolved.imports.map((i) => i.binding)).toEqual([
      'GetUserByToken',
      'Auth',
    ]);
    expect(resolved.imports.map((i) => i.specifier)).toEqual([
      '../../../services/http/middleware/GetUserByToken.ts',
      '../../../services/http/middleware/Auth.ts',
    ]);
  });

  it('inherits middleware through the extends-walk (`Inherited` fixture)', async () => {
    const { flat, resolved } = await flattenOne(
      path.join(fixtures, 'Inherited.ts'),
      '/inherited',
    );
    // Inherited declares no own middleware → inherits AbstractController's.
    expect(resolved.middleware.flatMap((s) => s.bindings)).toEqual([
      'GetUserByToken',
      'Auth',
    ]);
    expect(chainNames(flat)).toEqual(['GetUserByToken', 'Auth']);
  });
});
