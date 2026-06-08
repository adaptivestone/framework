/**
 * Differential gate: the AST emit path must produce BYTE-IDENTICAL `.routes.gen.ts`
 * to the boot path. Both oracles run IN MEMORY (no shared gen-file writes), so the
 * test is isolated from the golden test, which mutates the same fixture directory.
 *
 *  - per fixture: `emitGenFileViaAst` (AST) === boot single-controller emit.
 *  - full pipeline: `generateRouteTypesViaAst` discovers + emits every fixture
 *    with no `needsBoot` fallback.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import ControllerManager from '../controllers/index.ts';
import { noopLogger } from '../helpers/logger.ts';
import type { IApp } from '../server.ts';
import { RouteRegistry } from '../services/http/routing/RouteRegistry.ts';
import { emitGenFileViaAst, generateRouteTypesViaAst } from './astEmit.ts';
import { extractControllerMeta } from './collectMetadata.ts';
import { emitGenFile } from './emit.ts';
import { ghostController } from './ghostController.ts';
import { chainFor, indexFlatRoutes } from './routeTypes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const controllersDir = path.join(here, '__fixtures__/controllers');
const FIXTURES = ['File', 'Inherited', 'Schemas'];

const fakeApp = {
  logger: noopLogger,
  getConfig: () => ({}),
  getModel: () => ({}),
  foldersConfig: { controllers: controllersDir },
} as unknown as IApp;

/** Boot single-controller emit, fully in memory (no disk write). */
async function bootEmit(srcPath: string): Promise<string> {
  const mod = await import(pathToFileURL(srcPath).href);
  const registry = new RouteRegistry();
  const app = {
    ...fakeApp,
    httpServer: { routeRegistry: registry },
  } as unknown as IApp;
  const cm = new ControllerManager(app);
  const ghost = ghostController(mod.default, app, '');
  cm.registerControllerInstance(ghost, '', { skipWrap: true });
  const flatByKey = indexFlatRoutes(registry.flatten());
  const meta = extractControllerMeta(ghost);
  const chains = meta.routes.map((r) => chainFor(r, meta.urlPrefix, flatByKey));
  return emitGenFile({ controller: meta, srcPath, chains });
}

describe('astEmit — byte-identical to the boot path (in memory)', () => {
  const boot: Record<string, string> = {};

  beforeAll(async () => {
    for (const name of FIXTURES) {
      boot[name] = await bootEmit(path.join(controllersDir, `${name}.ts`));
    }
  });

  it.each(FIXTURES)('AST emit == boot emit for %s', async (name) => {
    const ast = await emitGenFileViaAst(
      path.join(controllersDir, `${name}.ts`),
    );
    expect(ast.needsBoot).toBe(false);
    expect(ast.text).toBe(boot[name]);
  });
});

describe('generateRouteTypesViaAst — full pipeline', () => {
  it('discovers + emits every fixture with no boot fallback', async () => {
    const { written, needsBoot } = await generateRouteTypesViaAst(
      fakeApp,
      noopLogger,
    );
    expect(needsBoot).toEqual([]);
    expect(written).toBe(FIXTURES.length);
  }, 30_000);
});
