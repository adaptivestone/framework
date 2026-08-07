/**
 * Tests for the AST `BaseModel` detector (`astModel.ts`): is a model a
 * `BaseModel` subclass, decided from source without importing it. Direct,
 * aliased, indirect (one level up), and legacy (non-BaseModel) cases.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { isBaseModelSource } from './astModel.ts';

let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ast-model-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(name: string, src: string): Promise<string> {
  const full = path.join(dir, name);
  await writeFile(full, src, 'utf8');
  return full;
}

describe('isBaseModelSource', () => {
  it('detects a direct `extends BaseModel`', async () => {
    const file = await write(
      'User.ts',
      `import { BaseModel } from '../modules/BaseModel.ts';
export default class User extends BaseModel {}`,
    );
    assert.strictEqual(await isBaseModelSource(file), true);
  });

  it('detects an aliased BaseModel import via the specifier', async () => {
    const file = await write(
      'Aliased.ts',
      `import { BaseModel as BM } from '@adaptivestone/framework/modules/BaseModel.js';
export default class Aliased extends BM {}`,
    );
    assert.strictEqual(await isBaseModelSource(file), true);
  });

  it('returns false for a legacy (non-BaseModel) model', async () => {
    const file = await write(
      'Legacy.ts',
      `import mongoose from 'mongoose';
export default class Legacy {
  get mongooseModel() { return mongoose.model('Legacy', schema); }
}`,
    );
    assert.strictEqual(await isBaseModelSource(file), false);
  });

  it('detects indirect inheritance through a relative parent', async () => {
    await write(
      'MyBase.ts',
      `import { BaseModel } from '../modules/BaseModel.ts';
export default class MyBase extends BaseModel {}`,
    );
    const file = await write(
      'Derived.ts',
      `import MyBase from './MyBase.ts';
export default class Derived extends MyBase {}`,
    );
    assert.strictEqual(await isBaseModelSource(file), true);
  });

  it('serves a repeated lookup from the cache', async () => {
    const file = await write(
      'Cached.ts',
      `import { BaseModel } from '../modules/BaseModel.ts';
export default class Cached extends BaseModel {}`,
    );
    const cache = new Map<string, boolean>();
    assert.strictEqual(await isBaseModelSource(file, 0, cache), true);
    assert.strictEqual(cache.get(file), true);
    // Second call short-circuits on the cached value (no re-read/parse).
    assert.strictEqual(await isBaseModelSource(file, 0, cache), true);
  });

  it('returns false for an unreadable / missing file', async () => {
    assert.strictEqual(
      await isBaseModelSource(path.join(dir, 'no-such-model.ts')),
      false,
    );
  });

  it('falls back to the binding name when the BaseModel import is unresolved', async () => {
    // `extends BaseModel` with no matching import → match on the binding name.
    const yes = await write(
      'NoImport.ts',
      `export default class X extends BaseModel {}`,
    );
    assert.strictEqual(await isBaseModelSource(yes), true);
    const no = await write(
      'NoImportOther.ts',
      `export default class Y extends SomethingElse {}`,
    );
    assert.strictEqual(await isBaseModelSource(no), false);
  });

  it('returns false when a bare-package ancestor cannot be resolved', async () => {
    const file = await write(
      'BarePkg.ts',
      `import SomeBase from 'totally-nonexistent-pkg-xyz';
export default class X extends SomeBase {}`,
    );
    assert.strictEqual(await isBaseModelSource(file), false);
  });
});
