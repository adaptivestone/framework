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
import path from 'node:path';
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
    const controller: ControllerMeta = {
      className: 'Child',
      prefix: '',
      urlPrefix: '/child',
      routes: [
        {
          method: 'get',
          path: '/',
          handlerName: 'list',
          hasSchema: false,
          hasQuerySchema: false,
        } satisfies RouteMeta,
      ],
    };
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

    const controller: ControllerMeta = {
      className: 'CustomAuth',
      prefix: '',
      urlPrefix: '/custom',
      routes: [
        {
          method: 'get',
          path: '/',
          handlerName: 'handle',
          hasSchema: false,
          hasQuerySchema: false,
        },
      ],
    };
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

    const controller: ControllerMeta = {
      className: 'Standalone',
      prefix: '',
      urlPrefix: '/x',
      routes: [
        {
          method: 'get',
          path: '/',
          handlerName: 'list',
          hasSchema: false,
          hasQuerySchema: false,
        },
      ],
    };
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

    const controller: ControllerMeta = {
      className: 'Upload',
      prefix: '',
      urlPrefix: '/upload',
      routes: [
        {
          method: 'post',
          path: '/upload',
          handlerName: 'upload',
          hasSchema: true,
          requestContentTypes: ['application/json', 'multipart/form-data'],
          hasQuerySchema: false,
        } satisfies RouteMeta,
      ],
    };

    const output = await emitGenFile({ controller, srcPath, chains: [[]] });

    expect(output).toContain("{ contentType: 'application/json' }");
    expect(output).toContain("['request']['application/json']");
    expect(output).toContain("{ contentType: 'multipart/form-data' }");
    expect(output).toContain("['request']['multipart/form-data']");
    // The two media-type branches are joined as a union.
    expect(output).toMatch(/\) \| \(/);
  });
});
