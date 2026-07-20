/**
 * Discovery + folder-prefix tests for the route-type codegen (doc 06).
 *
 * Uses throwaway temp controller dirs (auto-cleaned) so the real pipeline
 * (`generateRouteTypesViaAst`) can be driven against arbitrary folder shapes
 * without committing fixtures or generated files. Controllers here are minimal
 * standalone classes (no `extends`) — enough to exercise mount-path math,
 * merged discovery, and conflict reporting.
 */

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { noopLogger } from '../helpers/logger.ts';
import {
  controllerRoutePrefix,
  defaultControllerHttpPath,
} from '../modules/AbstractController.ts';
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
  /**
   * Mount path = `/{folderPrefix}/{ClassName}` fully lowercased.
   * Folder can be multi-segment (`admin/sub`). Class name (not file name) is
   * the last segment — keep `User.ts` + `class User` aligned in real apps.
   */
  it('defaultControllerHttpPath includes the folder prefix', () => {
    expect.assertions(8);
    expect(defaultControllerHttpPath('', 'Users')).toBe('/users');
    expect(defaultControllerHttpPath('admin', 'Users')).toBe('/admin/users');
    expect(defaultControllerHttpPath('admin/sub', 'Users')).toBe(
      '/admin/sub/users',
    );
    // Same final basename (User.ts) under different folders → different mounts.
    expect(defaultControllerHttpPath('admin', 'User')).toBe('/admin/user');
    expect(defaultControllerHttpPath('moderator', 'User')).toBe(
      '/moderator/user',
    );
    // CamelCase folder + compound class name — both lowercased as whole path.
    expect(defaultControllerHttpPath('someFolder', 'UserAdmin')).toBe(
      '/somefolder/useradmin',
    );
    expect(defaultControllerHttpPath('someFolder', 'SomeBigName')).toBe(
      '/somefolder/somebigname',
    );
    expect(defaultControllerHttpPath('a/b/c', 'SomeBigName')).toBe(
      '/a/b/c/somebigname',
    );
  });

  it('omits parenthesized route-group segments from default paths', () => {
    expect(controllerRoutePrefix('(group)')).toBe('');
    expect(controllerRoutePrefix('(group)/admin')).toBe('admin');
    expect(controllerRoutePrefix('api/(internal)/reports')).toBe('api/reports');
    expect(controllerRoutePrefix('(group)\\admin')).toBe('admin');
    expect(defaultControllerHttpPath('(group)', 'Reports')).toBe('/reports');
    expect(defaultControllerHttpPath('(group)/admin', 'Settings')).toBe(
      '/admin/settings',
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

  it('AST codegen keeps route groups in the file layout but not the URL', async () => {
    const dir = await makeControllers({
      '(group)/Reports.ts': ctrl('Reports', 'get', '/list'),
      '(group)/admin/Settings.ts': ctrl('Settings', 'get', '/'),
    });

    await generateRouteTypesViaAst(appFor(dir), noopLogger);
    const reports = await specFromExtracted(
      path.join(dir, '(group)/Reports.ts'),
      '(group)',
    );
    const settings = await specFromExtracted(
      path.join(dir, '(group)/admin/Settings.ts'),
      '(group)/admin',
    );

    expect(reports.resolved.urlPrefix).toBe('/reports');
    expect(settings.resolved.urlPrefix).toBe('/admin/settings');
    expect(await readdir(path.join(dir, '(group)'))).toContain(
      'Reports.routes.gen.ts',
    );
    expect(await readdir(path.join(dir, '(group)/admin'))).toContain(
      'Settings.routes.gen.ts',
    );
  });

  it('same final file (User.ts) in multiple folders resolve distinct mounts', async () => {
    expect.assertions(1);
    const dir = await makeControllers({
      'admin/User.ts': ctrl('User', 'get', '/'),
      'moderator/User.ts': ctrl('User', 'get', '/'),
      'someFolder/User.ts': ctrl('User', 'get', '/'),
    });
    const mounts = await Promise.all(
      (
        [
          ['admin/User.ts', 'admin'],
          ['moderator/User.ts', 'moderator'],
          ['someFolder/User.ts', 'someFolder'],
        ] as const
      ).map(async ([rel, prefix]) => {
        const { resolved } = await specFromExtracted(
          path.join(dir, rel),
          prefix,
        );
        return resolved.urlPrefix;
      }),
    );
    // Same class + basename; only the folder prefix separates the mounts.
    expect(mounts).toEqual([
      '/admin/user',
      '/moderator/user',
      '/somefolder/user',
    ]);
  });

  it('compound class name SomeBigName under a folder mounts lowercased', async () => {
    expect.assertions(1);
    const dir = await makeControllers({
      'someFolder/SomeBigName.ts': ctrl('SomeBigName', 'get', '/list'),
    });
    const { resolved } = await specFromExtracted(
      path.join(dir, 'someFolder/SomeBigName.ts'),
      'someFolder',
    );
    expect(resolved.urlPrefix).toBe('/somefolder/somebigname');
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

  it('multiple folders with the same basename emit sibling gen files without conflict', async () => {
    expect.assertions(6);
    const dir = await makeControllers({
      // Same final path segment User.ts — mounts differ by folder prefix only.
      'admin/User.ts': ctrl('User', 'get', '/'),
      'moderator/User.ts': ctrl('User', 'get', '/'),
      // Compound name + camelCase folder.
      'someFolder/SomeBigName.ts': ctrl('SomeBigName', 'post', '/run'),
      'someFolder/UserAdmin.ts': ctrl('UserAdmin', 'get', '/'),
    });
    await generateRouteTypesViaAst(appFor(dir), noopLogger);

    expect(await readdir(path.join(dir, 'admin'))).toContain(
      'User.routes.gen.ts',
    );
    expect(await readdir(path.join(dir, 'moderator'))).toContain(
      'User.routes.gen.ts',
    );
    expect(await readdir(path.join(dir, 'someFolder'))).toEqual(
      expect.arrayContaining([
        'SomeBigName.routes.gen.ts',
        'UserAdmin.routes.gen.ts',
      ]),
    );

    // Resolve path math still matches what emit registered (no shared-path throw).
    const admin = await specFromExtracted(
      path.join(dir, 'admin/User.ts'),
      'admin',
    );
    const moderator = await specFromExtracted(
      path.join(dir, 'moderator/User.ts'),
      'moderator',
    );
    const big = await specFromExtracted(
      path.join(dir, 'someFolder/SomeBigName.ts'),
      'someFolder',
    );
    expect(admin.resolved.urlPrefix).toBe('/admin/user');
    expect(moderator.resolved.urlPrefix).toBe('/moderator/user');
    expect(big.resolved.urlPrefix).toBe('/somefolder/somebigname');
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

  it('degrades a schema-bearing .js controller with no .d.ts (no untyped self-import)', async () => {
    expect.assertions(5);
    const withSchema = (name: string, route: string) =>
      `class ${name} {\n  get routes() { return { post: { '${route}': { handler: this.h, request: {} } } }; }\n  h() {}\n}\nexport default ${name};\n`;
    const dir = await makeControllers({
      // Untyped .js controller — importing it would be TS7016 in a strict
      // consumer build, so the gen file must NOT self-import it.
      'Boat.js': withSchema('Boat', '/x'),
      // .js WITH a sibling declaration → importable → keep precise navigation.
      'Typed.js': withSchema('Typed', '/y'),
      'Typed.d.ts':
        'declare class Typed { get routes(): unknown; }\nexport default Typed;\n',
    });
    await generateRouteTypesViaAst(appFor(dir), noopLogger);
    const boat = await readFile(path.join(dir, 'Boat.routes.gen.ts'), 'utf8');
    const typed = await readFile(path.join(dir, 'Typed.routes.gen.ts'), 'utf8');
    // Untyped .js → degraded: no self-import, no schema navigation, has the note.
    expect(boat).not.toContain("from './Boat.js'");
    expect(boat).not.toContain('InferOutput');
    expect(boat).toMatch(/no type declaration/);
    // .js with a sibling .d.ts → importable → precise navigation preserved.
    expect(typed).toContain("from './Typed.js'");
    expect(typed).toContain('InferOutput');
  });

  it('drops an untyped .js middleware from the provides chain (no TS7016 import)', async () => {
    expect.assertions(4);
    const guardedCtrl = (name: string, route: string, mwImport: string) =>
      `import Guard from '${mwImport}';\nclass ${name} {\n  get routes() { return { get: { '${route}': { handler: this.h } } }; }\n  h() {}\n  static get middleware() { return new Map([['/{*splat}', [Guard]]]); }\n}\nexport default ${name};\n`;
    const mwSrc = (name: string) =>
      `class ${name} { async middleware(req, res, next) { return next(); } }\nexport default ${name};\n`;
    const dir = await makeControllers({
      // Guarded by an untyped .js middleware (no sibling .d.ts) → must be dropped.
      'PayJs.ts': guardedCtrl('PayJs', '/a', './GuardJs.js'),
      'GuardJs.js': mwSrc('GuardJs'),
      // Guarded by a .ts middleware → kept (precise provides).
      'PayTs.ts': guardedCtrl('PayTs', '/b', './GuardTs.ts'),
      'GuardTs.ts': mwSrc('GuardTs'),
    });
    await generateRouteTypesViaAst(appFor(dir), noopLogger);
    const payJs = await readFile(path.join(dir, 'PayJs.routes.gen.ts'), 'utf8');
    const payTs = await readFile(path.join(dir, 'PayTs.routes.gen.ts'), 'utf8');
    // Untyped .js middleware → dropped from BOTH the import and the tuple.
    expect(payJs).not.toContain("from './GuardJs.js'");
    expect(payJs).not.toContain('typeof Guard');
    // .ts middleware → kept.
    expect(payTs).toContain("from './GuardTs.ts'");
    expect(payTs).toContain('typeof Guard');
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
