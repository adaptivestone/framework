/**
 * Golden-fixture integration test for the route-type codegen.
 *
 * Every other codegen test asserts string fragments in the emitted output —
 * which is exactly why a string of type-level codegen bugs shipped (an empty
 * `UnionAppInfoProvides<readonly []>` is wrong, but a `toContain` check never
 * notices unless someone thought to assert it). This test runs the REAL
 * pipeline (`generateRouteTypes`, boot-free) against fixture controllers and
 * then `tsc`-checks the generated types against handlers that actually read
 * `req.appInfo.user` with no guard. It covers, in one gate:
 *   - bug 1a: empty chain for a root `/` route under a non-root prefix
 *   - bug 1b: middleware imported under a binding ≠ its class name (`Auth`)
 *   - bug 2 : `appInfo.user` must be present AND non-optional behind `Auth`
 *   - inherited default middleware (a controller with no own middleware Map)
 *
 * The bare-package-ancestor variant of inheritance is unit-tested in
 * `emit.test.ts` (it can't run end-to-end inside this repo).
 */

import { execFileSync } from 'node:child_process';
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { noopLogger } from '../helpers/logger.ts';
import type { IApp } from '../server.ts';
import { generateRouteTypes } from './routeTypes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const fixturesDir = path.join(here, '__fixtures__');
const controllersDir = path.join(fixturesDir, 'controllers');

describe('codegen golden fixtures (real pipeline + tsc gate)', () => {
  it('emits types that type-check against realistic handler usage', async () => {
    // Boot-free codegen: a minimal app is all `generateRouteTypes` reads.
    const app = {
      logger: noopLogger,
      foldersConfig: { controllers: controllersDir },
      httpServer: null,
    } as unknown as IApp;

    // Delete stale generated files first: a regression that makes codegen SKIP
    // a fixture must surface as a missing file below, not pass on a leftover.
    for (const f of await readdir(controllersDir)) {
      if (f.endsWith('.routes.gen.ts')) {
        await rm(path.join(controllersDir, f));
      }
    }

    await generateRouteTypes(app, noopLogger);

    // Chain content (clear signal independent of tsc). `File` declares its own
    // `[GetUserByToken, Auth]`; `Inherited` declares none and picks them up from
    // `AbstractController`'s default middleware via the extends-walk. Assert both
    // middlewares are present (under the `Auth` binding, never `AuthMiddleware`)
    // and the tuple is non-empty — the tsc gate below is the real correctness
    // check. `readFile` throwing here means codegen skipped the fixture.
    const fileGen = await readFile(
      path.join(controllersDir, 'File.routes.gen.ts'),
      'utf8',
    );
    const inheritedGen = await readFile(
      path.join(controllersDir, 'Inherited.routes.gen.ts'),
      'utf8',
    );
    for (const gen of [fileGen, inheritedGen]) {
      expect(gen).toMatch(/UnionAppInfoProvides<readonly \[[^\]]+\]>/);
      expect(gen).toMatch(/typeof GetUserByToken\b/);
      expect(gen).toMatch(/typeof Auth\b/);
      expect(gen).not.toContain('AuthMiddleware');
    }

    // The real gate: the handlers read `req.appInfo.user` with no guard, so a
    // regression in any of the bugs above makes this `tsc` run fail.
    const result = runTsc();
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
  }, 60_000);
});

function runTsc(): { ok: boolean; output: string } {
  const tsc = path.join(repoRoot, 'node_modules/.bin/tsc');
  try {
    execFileSync(
      tsc,
      ['--noEmit', '-p', path.join(fixturesDir, 'tsconfig.json')],
      { cwd: repoRoot, stdio: 'pipe' },
    );
    return { ok: true, output: '' };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const output = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`;
    return { ok: false, output };
  }
}
