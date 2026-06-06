/**
 * Tests the codegen's emit step, focused on the inheritance case — when a
 * child controller extends a parent that declares `static get middleware()`
 * but the child doesn't import those middleware classes itself.
 *
 * Regression: before P1j, the emit step's import-presence filter dropped
 * inherited middlewares because they weren't in the child's own imports.
 * The fix walks the `extends` chain via the child's import statement for
 * its parent class.
 */

import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ControllerMeta,
  MiddlewareRef,
  RouteMeta,
} from './collectMetadata.ts';
import { emitGenFile } from './emit.ts';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join('/tmp', 'codegen-emit-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeFile(name: string, content: string): Promise<string> {
  const full = path.join(tmpDir, name);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
  return full;
}

/** Standard single-route controller metadata; override route fields as needed. */
function makeController(
  className: string,
  urlPrefix: string,
  route: Partial<RouteMeta> & { handlerName: string },
): ControllerMeta {
  return {
    className,
    prefix: '',
    urlPrefix,
    routes: [
      {
        method: 'get',
        path: '/',
        hasSchema: false,
        hasQuerySchema: false,
        ...route,
      },
    ],
  };
}

/** Import a module's default export by absolute path. */
const importDefault = async (absPath: string): Promise<unknown> =>
  (await import(pathToFileURL(absPath).href)).default;

describe('emit inheritance walk', () => {
  it('picks up middleware imports from a parent controller class', async () => {
    // Parent imports SomeMW and uses it in its static middleware Map.
    await writeFile(
      'Parent.ts',
      `import AbstractController from '@adaptivestone/framework/modules/AbstractController.js';
import SomeMW from '../middleware/SomeMW.js';

class Parent extends AbstractController {
  static get middleware() {
    return new Map([['/{*splat}', [SomeMW]]]);
  }
}
export default Parent;
`,
    );

    // Child extends Parent. Does NOT import SomeMW. Has its own route.
    const childPath = await writeFile(
      'Child.ts',
      `import Parent from './Parent.ts';

class Child extends Parent {
  get routes() {
    return { get: { '/': { handler: this.list } } };
  }
  async list() { return; }
}
export default Child;
`,
    );

    // Synthetic metadata + chain — bypasses the runtime instantiation
    // path so the test stays focused on emit's import-resolution logic.
    const controller = makeController('Child', '/child', {
      handlerName: 'list',
    });
    const chains: MiddlewareRef[][] = [[{ className: 'SomeMW' }]];

    const output = await emitGenFile({
      controller,
      srcPath: childPath,
      chains,
    });

    // The inherited middleware should appear in the chain AND have an
    // import line — even though Child.ts never imports SomeMW.
    expect(output).toContain(
      "import type SomeMW from '../middleware/SomeMW.js';",
    );
    expect(output).toContain('readonly [typeof SomeMW]');
  });

  it("child's own imports override the parent's on name collision", async () => {
    // Both files declare a binding named `Shared`, pointing at different
    // module paths. The child's import should win (last-applied wins).
    await writeFile(
      'BaseAuth.ts',
      `import AbstractController from '@adaptivestone/framework/modules/AbstractController.js';
import Shared from '../parent-mw/Shared.js';

class BaseAuth extends AbstractController {
  static get middleware() {
    return new Map([['/{*splat}', [Shared]]]);
  }
}
export default BaseAuth;
`,
    );
    const childPath = await writeFile(
      'CustomAuth.ts',
      `import BaseAuth from './BaseAuth.ts';
import Shared from '../child-mw/Shared.js';

class CustomAuth extends BaseAuth {
  get routes() {
    return { get: { '/': { handler: this.handle } } };
  }
  async handle() { return; }
}
export default CustomAuth;
`,
    );

    const controller = makeController('CustomAuth', '/custom', {
      handlerName: 'handle',
    });
    const chains: MiddlewareRef[][] = [[{ className: 'Shared' }]];

    const output = await emitGenFile({
      controller,
      srcPath: childPath,
      chains,
    });

    expect(output).toContain(
      "import type Shared from '../child-mw/Shared.js';",
    );
    expect(output).not.toContain(
      "import type Shared from '../parent-mw/Shared.js';",
    );
  });

  it('resolves a middleware whose class name differs from its import binding', async () => {
    // The middleware default-exports `AuthMiddleware`, but the controller
    // imports it under the binding `Auth` (mirrors the framework's own
    // `Auth.ts`). The chain ref carries the live class name (`AuthMiddleware`)
    // — emit must map it back to the `Auth` binding via module identity, not
    // drop it for the name mismatch.
    const mwPath = await writeFile(
      'AuthMw.ts',
      `class AuthMiddleware {}\nexport default AuthMiddleware;\n`,
    );
    const childPath = await writeFile(
      'Guarded.ts',
      `import AbstractController from '@adaptivestone/framework/modules/AbstractController.js';
import Auth from './AuthMw.ts';

class Guarded extends AbstractController {
  get routes() {
    return { get: { '/': { handler: this.list } } };
  }
  static get middleware() {
    return new Map([['/{*splat}', [Auth]]]);
  }
  async list() { return; }
}
export default Guarded;
`,
    );
    const AuthClass = await importDefault(mwPath);

    const controller = makeController('Guarded', '/guarded', {
      handlerName: 'list',
    });
    const chains: MiddlewareRef[][] = [
      [{ className: 'AuthMiddleware', Class: AuthClass }],
    ];

    const output = await emitGenFile({
      controller,
      srcPath: childPath,
      chains,
    });

    // Emitted under the binding the controller actually uses, never the
    // class name — `typeof AuthMiddleware` would be an unbound reference.
    expect(output).toContain("import type Auth from './AuthMw.ts';");
    expect(output).toContain('readonly [typeof Auth]');
    expect(output).not.toContain('AuthMiddleware');
  });

  it('resolves inherited middleware through a BARE-package ancestor (the gap fix)', async () => {
    // A consumer extending the framework's `AbstractController` via a BARE
    // specifier (not a relative sibling) and declaring NO own static
    // middleware. The inherited `[GetUserByToken, Auth]` live in the package's
    // own files, imported there RELATIVELY. emit must (1) resolve the bare
    // ancestor through `createRequire` honoring the package `exports` map,
    // and (2) rewrite those relative imports into bare specifiers the
    // consumer's gen file can resolve — because the public subpath tree
    // mirrors `src/`.
    const pkgRoot = path.join(tmpDir, 'bare-consumer');
    const dist = path.join(
      pkgRoot,
      'node_modules/@adaptivestone/framework/dist',
    );
    await fs.mkdir(dist, { recursive: true });
    await fs.writeFile(
      path.join(pkgRoot, 'node_modules/@adaptivestone/framework/package.json'),
      JSON.stringify({
        name: '@adaptivestone/framework',
        type: 'module',
        exports: { './*': './dist/*' },
      }),
      'utf8',
    );
    // Ancestor imports its middleware RELATIVELY (mirrors the real file) and
    // terminates its extends chain at a relative `Base`.
    await fs.mkdir(path.join(dist, 'modules'), { recursive: true });
    await fs.writeFile(
      path.join(dist, 'modules/AbstractController.js'),
      `import Auth from '../services/http/middleware/Auth.js';
import GetUserByToken from '../services/http/middleware/GetUserByToken.js';
import Base from './Base.js';
class AbstractController extends Base {
  static get middleware() {
    return new Map([['/{*splat}', [GetUserByToken, Auth]]]);
  }
}
export default AbstractController;
`,
      'utf8',
    );
    // `Base` (the bare ancestor's OWN relative parent, a `.js` file inside the
    // package) imports a middleware relatively too — exercises walking bare →
    // relative grandparent, finding its built `.js` (existence check), and
    // rewriting the grandparent's relative import to a bare specifier.
    await fs.writeFile(
      path.join(dist, 'modules/Base.js'),
      `import Logger from '../services/http/middleware/Logger.js';
class Base {}
export default Base;
`,
      'utf8',
    );
    await fs.mkdir(path.join(dist, 'services/http/middleware'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(dist, 'services/http/middleware/Auth.js'),
      `class AuthMiddleware {}\nexport default AuthMiddleware;\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(dist, 'services/http/middleware/GetUserByToken.js'),
      `class GetUserByToken {}\nexport default GetUserByToken;\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(dist, 'services/http/middleware/Logger.js'),
      `class Logger {}\nexport default Logger;\n`,
      'utf8',
    );

    // Consumer lives at the package root so `createRequire(consumerPath)`
    // finds the sibling node_modules and resolves the bare specifier.
    const consumerPath = path.join(pkgRoot, 'Consumer.ts');
    await fs.writeFile(
      consumerPath,
      `import AbstractController from '@adaptivestone/framework/modules/AbstractController.js';

class Consumer extends AbstractController {
  get routes() {
    return { get: { '/': { handler: this.list } } };
  }
  async list() { return; }
}
export default Consumer;
`,
      'utf8',
    );

    // The chain's live classes come from the SAME package the consumer
    // resolves — loaded here from the consumer's own location (its sibling
    // node_modules), exactly as emit's identity-match does. Fully self-contained:
    // depends on the fake package above, not on the framework's built `dist/`.
    const req = createRequire(consumerPath);
    const mw = 'services/http/middleware';
    const AuthClass = await importDefault(
      req.resolve(`@adaptivestone/framework/${mw}/Auth.js`),
    );
    const GetUserByTokenClass = await importDefault(
      req.resolve(`@adaptivestone/framework/${mw}/GetUserByToken.js`),
    );
    const LoggerClass = await importDefault(
      req.resolve(`@adaptivestone/framework/${mw}/Logger.js`),
    );

    const controller = makeController('Consumer', '/consumer', {
      handlerName: 'list',
    });
    const chains: MiddlewareRef[][] = [
      [
        { className: 'GetUserByToken', Class: GetUserByTokenClass },
        { className: 'AuthMiddleware', Class: AuthClass },
        { className: 'Logger', Class: LoggerClass },
      ],
    ];

    const output = await emitGenFile({
      controller,
      srcPath: consumerPath,
      chains,
    });

    // All three inherited middlewares emit under BARE specifiers rooted at the
    // package subpath (rewritten from each ancestor's relative imports) —
    // including `Logger`, which lives two levels up via the bare ancestor's own
    // relative parent. `Auth` resolves under its binding, never `AuthMiddleware`.
    expect(output).toContain(
      "import type GetUserByToken from '@adaptivestone/framework/services/http/middleware/GetUserByToken.js';",
    );
    expect(output).toContain(
      "import type Auth from '@adaptivestone/framework/services/http/middleware/Auth.js';",
    );
    expect(output).toContain(
      "import type Logger from '@adaptivestone/framework/services/http/middleware/Logger.js';",
    );
    expect(output).toContain(
      'UnionAppInfoProvides<readonly [typeof GetUserByToken, typeof Auth, typeof Logger]>',
    );
    expect(output).not.toContain('AuthMiddleware');
  });

  it('identity-matches past a binding whose name collides with the class name', async () => {
    // The controller imports the real middleware as `Auth` (default export
    // `AuthMiddleware`) and, separately, an UNRELATED class under the binding
    // `AuthMiddleware`. A name-only match would wrongly pick the collision;
    // identity matching resolves the chain's live class to its true binding.
    // (No `extends` — the binding resolution is what's under test.)
    const authMwPath = await writeFile(
      'AuthMw.ts',
      `class AuthMiddleware {}\nexport default AuthMiddleware;\n`,
    );
    await writeFile(
      'Other.ts',
      `class Unrelated {}\nexport default Unrelated;\n`,
    );
    const childPath = await writeFile(
      'Collision.ts',
      `import Auth from './AuthMw.ts';
import AuthMiddleware from './Other.ts';

class Collision {
  get routes() {
    return { get: { '/': { handler: this.list } } };
  }
  async list() { return; }
}
export default Collision;
`,
    );
    const AuthClass = await importDefault(authMwPath);

    const controller = makeController('Collision', '/collision', {
      handlerName: 'list',
    });
    const chains: MiddlewareRef[][] = [
      [{ className: 'AuthMiddleware', Class: AuthClass }],
    ];

    const output = await emitGenFile({
      controller,
      srcPath: childPath,
      chains,
    });

    expect(output).toContain("import type Auth from './AuthMw.ts';");
    expect(output).toContain('readonly [typeof Auth]');
    expect(output).not.toContain('Other.ts'); // the colliding import is not used
    expect(output).not.toContain('AuthMiddleware');
  });

  it('rebases an inherited middleware import from a parent in another directory', async () => {
    // Parent lives in a subdirectory and imports its middleware relative to ITS
    // location; the child (and its gen file) live a directory up. The emitted
    // import must be rebased so it resolves from the child's gen file.
    await writeFile(
      'sub/Parent.ts',
      `import AbstractController from '@adaptivestone/framework/modules/AbstractController.js';
import SomeMW from '../middleware/SomeMW.js';

class Parent extends AbstractController {
  static get middleware() {
    return new Map([['/{*splat}', [SomeMW]]]);
  }
}
export default Parent;
`,
    );
    const childPath = await writeFile(
      'CrossDir.ts',
      `import Parent from './sub/Parent.ts';

class CrossDir extends Parent {
  get routes() {
    return { get: { '/': { handler: this.list } } };
  }
  async list() { return; }
}
export default CrossDir;
`,
    );

    const controller = makeController('CrossDir', '/crossdir', {
      handlerName: 'list',
    });
    // Synthetic ref (binding === class name) — the point is the PATH rebasing.
    const chains: MiddlewareRef[][] = [[{ className: 'SomeMW' }]];

    const output = await emitGenFile({
      controller,
      srcPath: childPath,
      chains,
    });

    // Parent imports `../middleware/SomeMW.js` (relative to `sub/`); from the
    // child's gen file one dir up, that resolves as `./middleware/SomeMW.js`.
    expect(output).toContain(
      "import type SomeMW from './middleware/SomeMW.js';",
    );
    expect(output).not.toContain("'../middleware/SomeMW.js'");
    expect(output).toContain('readonly [typeof SomeMW]');
  });

  it("filters out chain entries that aren't imported anywhere in the extends chain", async () => {
    const childPath = await writeFile(
      'Standalone.ts',
      `import AbstractController from '@adaptivestone/framework/modules/AbstractController.js';

class Standalone extends AbstractController {
  get routes() {
    return { get: { '/': { handler: this.list } } };
  }
  async list() { return; }
}
export default Standalone;
`,
    );

    const controller = makeController('Standalone', '/x', {
      handlerName: 'list',
    });
    // Chain contains something not imported anywhere — cross-controller
    // bleed scenario. Should be filtered out, chain becomes empty.
    const chains: MiddlewareRef[][] = [[{ className: 'BleedingMW' }]];

    const output = await emitGenFile({
      controller,
      srcPath: childPath,
      chains,
    });

    expect(output).not.toContain('BleedingMW');
    expect(output).toContain('UnionAppInfoProvides<readonly []>');
  });
});

describe('emit content-type request map', () => {
  it('emits a contentType-discriminated union for a content-type map request', async () => {
    const srcPath = await writeFile(
      'Upload.ts',
      `import AbstractController from '@adaptivestone/framework/modules/AbstractController.js';

class Upload extends AbstractController {
  get routes() {
    return { post: { '/upload': { handler: this.upload, request: {} } } };
  }
  async upload() { return; }
}
export default Upload;
`,
    );

    const controller = makeController('Upload', '/upload', {
      method: 'post',
      path: '/upload',
      handlerName: 'upload',
      hasSchema: true,
      requestContentTypes: ['application/json', 'multipart/form-data'],
    });

    const output = await emitGenFile({ controller, srcPath, chains: [[]] });

    expect(output).toContain("{ contentType: 'application/json' }");
    expect(output).toContain("['request']['application/json']");
    expect(output).toContain("{ contentType: 'multipart/form-data' }");
    expect(output).toContain("['request']['multipart/form-data']");
    // The two media-type branches are joined as a union.
    expect(output).toMatch(/\) \| \(/);
  });
});
