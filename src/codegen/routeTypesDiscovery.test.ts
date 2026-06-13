/**
 * Discovery + folder-prefix tests for the route-type codegen (doc 06).
 *
 * Uses throwaway temp controller dirs (auto-cleaned) so the real pipeline
 * (`generateRouteTypesViaAst`) can be driven against arbitrary folder shapes
 * without committing fixtures or generated files. Controllers here are minimal
 * standalone classes (no `extends`) — enough to exercise mount-path math,
 * merged discovery, and conflict reporting.
 */

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { noopLogger } from '../helpers/logger.ts';
import { defaultControllerHttpPath } from '../modules/AbstractController.ts';
import type { IApp } from '../server.ts';
import { generateRouteTypesViaAst } from './astEmit.ts';
import { specFromExtracted } from './astSpec.ts';
import { generateAll } from './index.ts';

const tmpDirs: string[] = [];

async function makeControllers(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'codegen-disc-'));
  tmpDirs.push(dir);
  for (const [rel, src] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, src, 'utf8');
  }
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

/** Minimal declarative controller source (no extends → empty middleware). */
const ctrl = (
  className: string,
  method: string,
  route: string,
  httpPath?: string,
) => `
class ${className} {
  ${httpPath ? `getHttpPath() { return '${httpPath}'; }` : ''}
  get routes() {
    return { ${method}: { '${route}': { handler: this.h } } };
  }
  h() {}
}
export default ${className};
`;

const appFor = (controllers: string) =>
  ({
    logger: noopLogger,
    foldersConfig: { controllers },
    httpServer: null,
    // `generateAll` reads these for the app-level `genTypes.d.ts`; empty is fine.
    internalFilesCache: { configs: new Map(), modelPaths: [] },
  }) as unknown as IApp;

describe('codegen discovery — folder prefix & merge (doc 06)', () => {
  it('defaultControllerHttpPath includes the folder prefix', () => {
    expect.assertions(3);
    expect(defaultControllerHttpPath('', 'Users')).toBe('/users');
    expect(defaultControllerHttpPath('admin', 'Users')).toBe('/admin/users');
    expect(defaultControllerHttpPath('admin/sub', 'Users')).toBe(
      '/admin/sub/users',
    );
  });

  it('a nested controller mounts under its folder prefix', async () => {
    expect.assertions(1);
    const dir = await makeControllers({
      'nested/Items.ts': ctrl('Items', 'get', '/list'),
    });
    const { resolved } = await specFromExtracted(
      path.join(dir, 'nested/Items.ts'),
      'nested',
    );
    expect(resolved.urlPrefix).toBe('/nested/items');
  });

  it('emits gen files for nested AND digit-prefixed controllers', async () => {
    expect.assertions(2);
    const dir = await makeControllers({
      'nested/Items.ts': ctrl('Items', 'get', '/list'),
      // The old `/^[A-Z]/` filter dropped this; the runtime loader accepts it.
      '2FA.ts': ctrl('TwoFactor', 'get', '/verify'),
    });
    await generateRouteTypesViaAst(appFor(dir), noopLogger);
    expect(await readdir(path.join(dir, 'nested'))).toContain(
      'Items.routes.gen.ts',
    );
    expect(await readdir(dir)).toContain('2FA.routes.gen.ts');
  });

  it('root and nested controllers of the same name both mount (no conflict)', async () => {
    expect.assertions(2);
    const dir = await makeControllers({
      'Users.ts': ctrl('Users', 'get', '/list'),
      'nested/Users.ts': ctrl('Users', 'get', '/list'),
    });
    await generateRouteTypesViaAst(appFor(dir), noopLogger);
    expect(await readdir(dir)).toContain('Users.routes.gen.ts');
    expect(await readdir(path.join(dir, 'nested'))).toContain(
      'Users.routes.gen.ts',
    );
  });

  it('two controllers mounting at the same path fail, naming both files', async () => {
    expect.assertions(1);
    const dir = await makeControllers({
      'ConflictA.ts': ctrl('CtrlA', 'get', '/x', '/dup'),
      'ConflictB.ts': ctrl('CtrlB', 'get', '/x', '/dup'),
    });
    await expect(
      generateRouteTypesViaAst(appFor(dir), noopLogger),
    ).rejects.toThrow(
      /ConflictA\.ts[\s\S]*ConflictB\.ts|ConflictB\.ts[\s\S]*ConflictA\.ts/,
    );
  });

  it('deletes orphan gen files (no sibling source) while writing current ones (doc 08)', async () => {
    expect.assertions(2);
    const dir = await makeControllers({
      'Widget.ts': ctrl('Widget', 'get', '/list'),
      // A leftover gen file from a deleted/renamed controller — would break the
      // consumer's tsc (imports a missing `./Ghost.ts`).
      'Ghost.routes.gen.ts': "import './Ghost.ts';\nexport {};\n",
    });
    await generateRouteTypesViaAst(appFor(dir), noopLogger);
    const files = await readdir(dir);
    expect(files).toContain('Widget.routes.gen.ts');
    expect(files).not.toContain('Ghost.routes.gen.ts');
  });
});

describe('generateAll — atomicity & --check (doc 08)', () => {
  it('--check passes when up to date and fails (drift) when a gen file changes', async () => {
    expect.assertions(2);
    const dir = await makeControllers({
      'Widget.ts': ctrl('Widget', 'get', '/list'),
    });
    // genTypes.d.ts is written to process.cwd() — point it at the temp dir.
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    try {
      const app = appFor(dir);
      await generateAll(app, noopLogger); // write everything
      // Clean tree → --check resolves.
      await expect(
        generateAll(app, noopLogger, { check: true }),
      ).resolves.toBeUndefined();
      // Tamper a gen file → --check throws naming the stale file.
      await writeFile(
        path.join(dir, 'Widget.routes.gen.ts'),
        'tampered\n',
        'utf8',
      );
      await expect(
        generateAll(app, noopLogger, { check: true }),
      ).rejects.toThrow(/out of date[\s\S]*Widget\.routes\.gen\.ts/);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it('skips a non-analyzable controller (warning) and still writes the rest', async () => {
    expect.assertions(4);
    const dir = await makeControllers({
      'Good.ts': ctrl('Good', 'get', '/list'),
      // Non-literal `routes` getter (computed method key) → needsBoot. A
      // controller that extends another and merges `super.routes` hits the same
      // path; it must NOT block codegen for the analyzable controllers.
      'Dynamic.ts': `export default class Dynamic {
  get routes() { const m = 'get'; return { [m]: { '/x': this.h } }; }
  h() {}
}`,
    });
    const warnings: string[] = [];
    const logger = {
      info() {},
      warn: (m: string) => warnings.push(m),
      error() {},
    };
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    try {
      // Does not throw — the analyzable controller is generated, the other skipped.
      await expect(generateAll(appFor(dir), logger)).resolves.toBeUndefined();
      const files = await readdir(dir);
      expect(files).toContain('Good.routes.gen.ts'); // analyzable → written
      expect(files).not.toContain('Dynamic.routes.gen.ts'); // skipped, not written
      expect(warnings.join('\n')).toMatch(/skipped[\s\S]*Dynamic\.ts/); // warned + named
    } finally {
      cwdSpy.mockRestore();
    }
  });
});
