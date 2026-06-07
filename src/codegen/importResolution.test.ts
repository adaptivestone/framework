/**
 * Regression tests for the import/extends parser in `importResolution.ts`.
 *
 * The parser used to scan raw source with a global regex, so commented-out,
 * JSDoc-`@example`, or template-literal "imports" could overwrite real bindings;
 * comments inside `{ … }` blocks dropped bindings; a quoted/commented `extends`
 * poisoned the walk; the `as` sub-regex was quadratic; and extensionless
 * specifiers were never resolved. Later: the extends-walk followed the first
 * `class … extends` (a helper before the controller, not the controller), and
 * semicolon-less (ASI) imports collapsed so all but the first dropped. These
 * tests pin each fixed behavior.
 *
 * The parser internals aren't exported, so they're exercised through the public
 * `buildExtendsImportMap` (binding map) and `resolveBinding` (identity match).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExtendsImportMap, resolveBinding } from './importResolution.ts';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join('/tmp', 'codegen-import-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function write(name: string, content: string): Promise<string> {
  const full = path.join(tmpDir, name);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
  return full;
}

const importDefault = async (absPath: string): Promise<unknown> =>
  (await import(pathToFileURL(absPath).href)).default;

describe('parseImports — lexical safety', () => {
  it('ignores commented-out and JSDoc-@example imports (H2)', async () => {
    const src = `import RealAuth from './services/Auth.js';
// import RealAuth from './DECOY_comment.js';
/**
 * @example
 * import RealAuth from './DECOY_jsdoc.js';
 */
import Other from './Other.js';

class X extends NotImported {}
`;
    const map = await buildExtendsImportMap(path.join(tmpDir, 'H2.ts'), src);
    // The real binding wins — no DECOY path leaks in.
    expect(map.get('RealAuth')).toBe('./services/Auth.js');
    expect(map.get('Other')).toBe('./Other.js');
    expect([...map.values()].some((v) => v.includes('DECOY'))).toBe(false);
  });

  it('stops at the first non-import statement (template-literal decoy)', async () => {
    const src = `import RealAuth from './services/Auth.js';
const tmpl = \`import RealAuth from './DECOY_template.js'\`;
import AfterCode from './DECOY_after_code.js';

class X extends NotImported {}
`;
    const map = await buildExtendsImportMap(path.join(tmpDir, 'tmpl.ts'), src);
    expect(map.get('RealAuth')).toBe('./services/Auth.js');
    // Anything after the first non-import statement is not scanned.
    expect(map.has('AfterCode')).toBe(false);
    expect([...map.values()].some((v) => v.includes('DECOY'))).toBe(false);
  });

  it('keeps bindings despite comments inside the named block (M2)', async () => {
    const src = `import {
  A, // the A binding
  B as C, /* aliased */
  type D,
} from './x.js';
import E /* between */ from './e.js';

class X extends NotImported {}
`;
    const map = await buildExtendsImportMap(path.join(tmpDir, 'M2.ts'), src);
    expect(map.get('A')).toBe('./x.js');
    expect(map.get('C')).toBe('./x.js'); // B as C → bound as C
    expect(map.get('D')).toBe('./x.js'); // type D
    expect(map.get('E')).toBe('./e.js'); // comment between name and `from`
  });

  it('rejects a specifier containing a newline / control char (L1)', async () => {
    // A specifier with an embedded newline would inject a top-level statement
    // into the generated file — reject it instead of emitting it.
    const src = `import Bad from './a\nb.js';
import Good from './good.js';

class X extends NotImported {}
`;
    const map = await buildExtendsImportMap(path.join(tmpDir, 'L1.ts'), src);
    expect(map.has('Bad')).toBe(false);
    expect(map.get('Good')).toBe('./good.js');
  });

  it('parses a large malformed named block without catastrophic backtracking (M1)', async () => {
    // The old unanchored `as` regex was O(n²): a ~293 KB block hung `npm run gen`
    // for ~29s. Anchored + per-statement, this is linear. A 5s test timeout
    // makes a regression (hang) fail; the wall-clock assert gives a clear signal.
    const big = `import {${'a'.repeat(200_000)}} from './x.js';\nclass X extends NotImported {}`;
    const start = performance.now();
    const map = await buildExtendsImportMap(path.join(tmpDir, 'M1.ts'), big);
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(2000);
    // The whole block is one (malformed) binding name → still parsed, fast.
    expect(map.get('a'.repeat(200_000))).toBe('./x.js');
  }, 5000);

  it('parses consecutive semicolon-less (ASI) imports (Bug 2)', async () => {
    // Prettier `semi:false` / StandardJS style omits semicolons. Each import
    // must still be captured as its own statement — not collapsed so that only
    // the first is read. The side-effect import in the middle also must not
    // swallow the import that follows it.
    const src = `import A from './a.js'
import B from './b.js'
import './polyfill.js'
import {
  C,
  D,
} from './cd.js'

class X extends NotImported {}
`;
    const map = await buildExtendsImportMap(path.join(tmpDir, 'asi.ts'), src);
    expect(map.get('A')).toBe('./a.js');
    expect(map.get('B')).toBe('./b.js'); // dropped before the ASI fix
    expect(map.get('C')).toBe('./cd.js'); // multi-line braces survive too
    expect(map.get('D')).toBe('./cd.js');
  });

  it('still handles a newline between the binding and `from`', async () => {
    const src = `import A\n from './a.js';\nimport B from './b.js';\nclass X extends NotImported {}\n`;
    const map = await buildExtendsImportMap(
      path.join(tmpDir, 'nlfrom.ts'),
      src,
    );
    expect(map.get('A')).toBe('./a.js');
    expect(map.get('B')).toBe('./b.js');
  });
});

describe('resolveBinding / extends walk', () => {
  it('resolves an extensionless relative specifier (M4)', async () => {
    const mwPath = await write(
      'Mw.ts',
      'class RealMw {}\nexport default RealMw;\n',
    );
    const live = await importDefault(mwPath);
    // The controller imports it WITHOUT an extension: `import Mw from './Mw'`.
    const importMap = new Map<string, string>([['Mw', './Mw']]);
    const binding = await resolveBinding(
      { className: 'Mw', Class: live },
      importMap,
      tmpDir,
      new Map(),
      new Map(),
    );
    expect(binding).toBe('Mw');
  });

  it('does not let a commented/quoted `extends` poison the walk (M3)', async () => {
    // The real parent declares an inherited middleware import; decoys name a
    // different parent. The walk must follow the REAL parent (RealBase).
    await write(
      'RealBase.ts',
      `import InheritedMw from './InheritedMw.js';
class RealBase {
  static get middleware() {
    return new Map([['/{*splat}', [InheritedMw]]]);
  }
}
export default RealBase;
`,
    );
    const childSrc = `import RealBase from './RealBase.ts';
// class Decoy extends WrongParent {}
const note = "class Other extends AlsoWrong {}";

class Child extends RealBase {}
export default Child;
`;
    const childPath = await write('Child.ts', childSrc);
    const map = await buildExtendsImportMap(childPath, childSrc);
    // RealBase was walked (its middleware import merged), decoys ignored.
    expect(map.get('InheritedMw')).toBe('./InheritedMw.js');
    expect(map.get('RealBase')).toBe('./RealBase.ts');
  });

  it('does not read a sibling that escapes the package root (L2)', async () => {
    // A package boundary (package.json) makes the walk refuse a `../…` parent
    // that climbs out of the package, even though the target file exists.
    const pkg = path.join(tmpDir, 'pkg');
    await fs.mkdir(pkg, { recursive: true });
    await fs.writeFile(
      path.join(pkg, 'package.json'),
      JSON.stringify({ name: 'pkg', type: 'module' }),
      'utf8',
    );
    // An OUTSIDE parent that really exists on disk, with its own middleware.
    await write(
      'Outside.ts',
      `import OutsideMw from './OutsideMw.js';
class Outside {
  static get middleware() {
    return new Map([['/{*splat}', [OutsideMw]]]);
  }
}
export default Outside;
`,
    );
    // The controller lives inside `pkg/` and tries to extend `../Outside.ts`,
    // which sits above its package root.
    const childSrc = `import Outside from '../Outside.ts';
class Escaper extends Outside {}
export default Escaper;
`;
    const childPath = path.join(pkg, 'Escaper.ts');
    await fs.writeFile(childPath, childSrc, 'utf8');
    const map = await buildExtendsImportMap(childPath, childSrc);
    // The escaping parent is not walked, so its middleware import never merges.
    expect(map.has('OutsideMw')).toBe(false);
  });

  it('follows the exported controller, not a helper class declared first (Bug 1)', async () => {
    // A helper class is declared BEFORE the exported controller and extends a
    // DIFFERENT parent. The walk must follow the controller's parent (ExpBase),
    // so middleware inherited from ExpBase is present — not the helper's.
    await write(
      'ExpBase.ts',
      `import ExpInheritedMw from './ExpInheritedMw.js';
class ExpBase {
  static get middleware() {
    return new Map([['/{*splat}', [ExpInheritedMw]]]);
  }
}
export default ExpBase;
`,
    );
    const ctrlSrc = `import ExpBase from './ExpBase.ts';
import OtherBase from './OtherBase.ts';

class Helper extends OtherBase {}
export default class ExportedCtrl extends ExpBase {}
`;
    const ctrlPath = await write('ExportedCtrl.ts', ctrlSrc);
    const map = await buildExtendsImportMap(ctrlPath, ctrlSrc);
    expect(map.get('ExpInheritedMw')).toBe('./ExpInheritedMw.js');
  });

  it('resolves the parent via `export default Name` past a helper (Bug 1)', async () => {
    // The framework's own style: `class Ctrl extends Base { … }` then a separate
    // `export default Ctrl;`, with a helper class declared first. The exported
    // name must drive which class's `extends` clause the walk follows.
    await write(
      'NamedBase.ts',
      `import NamedMw from './NamedMw.js';
class NamedBase {
  static get middleware() {
    return new Map([['/{*splat}', [NamedMw]]]);
  }
}
export default NamedBase;
`,
    );
    const ctrlSrc = `import NamedBase from './NamedBase.ts';
import HelperBase from './HelperBase.ts';

class Helper extends HelperBase {}
class NamedCtrl extends NamedBase {}
export default NamedCtrl;
`;
    const ctrlPath = await write('NamedCtrl.ts', ctrlSrc);
    const map = await buildExtendsImportMap(ctrlPath, ctrlSrc);
    expect(map.get('NamedMw')).toBe('./NamedMw.js');
  });
});
