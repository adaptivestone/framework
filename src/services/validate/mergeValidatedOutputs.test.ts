import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addContentTypeDiscriminator,
  isPlainObject,
  mergeValidatedOutputs,
} from './mergeValidatedOutputs.ts';

describe('mergeValidatedOutputs', () => {
  it('preserves one output exactly, including arrays, primitives, and null', () => {
    const array = ['one', 'two'];
    for (const output of [array, 'value', 42, false, null]) {
      assert.strictEqual(mergeValidatedOutputs([output]), output);
    }
  });

  it('merges multiple plain objects in order with later keys winning', () => {
    const first = { shared: 'first', first: true };
    const second = { shared: 'second', second: true };

    assert.deepStrictEqual(mergeValidatedOutputs([first, second]), {
      shared: 'second',
      first: true,
      second: true,
    });
  });

  it('preserves an earlier key when a later optional output omits it', () => {
    assert.deepStrictEqual(mergeValidatedOutputs([{ shared: 'first' }, {}]), {
      shared: 'first',
    });
  });

  it('lets an explicitly present undefined overwrite an earlier key', () => {
    const merged = mergeValidatedOutputs([
      { shared: 'first' },
      { shared: undefined },
    ]);

    assert.ok(isPlainObject(merged));
    assert.strictEqual(
      Object.hasOwn(merged as Record<string, unknown>, 'shared'),
      true,
    );
    assert.strictEqual((merged as Record<string, unknown>).shared, undefined);
  });

  it('accepts null-prototype plain objects', () => {
    const first = Object.assign(Object.create(null), { first: true });
    const second = Object.assign(Object.create(null), { second: true });

    assert.strictEqual(isPlainObject(first), true);
    assert.deepStrictEqual(mergeValidatedOutputs([first, second]), {
      first: true,
      second: true,
    });
  });

  it('rejects incompatible multiple outputs instead of spreading them', () => {
    for (const output of [[], 'value', 42, false, null, new Date()]) {
      assert.throws(
        () => mergeValidatedOutputs([{ valid: true }, output]),
        /Cannot merge validated outputs.*plain objects/,
      );
    }
  });
});

describe('addContentTypeDiscriminator', () => {
  it('clones a plain object and leaves the validator output unchanged', () => {
    const output = { name: 'Alice' };
    const tagged = addContentTypeDiscriminator(output, 'application/json');

    assert.deepStrictEqual(tagged, {
      name: 'Alice',
      contentType: 'application/json',
    });
    assert.deepStrictEqual(output, { name: 'Alice' });
    assert.notStrictEqual(tagged, output);
  });

  it('overwrites a reserved contentType field without mutating the output', () => {
    const output = { contentType: 'schema-value', name: 'Alice' };
    const tagged = addContentTypeDiscriminator(output, 'application/json');

    assert.strictEqual(tagged.contentType, 'application/json');
    assert.deepStrictEqual(output, {
      contentType: 'schema-value',
      name: 'Alice',
    });
  });

  it('rejects arrays, primitives, and null', () => {
    for (const output of [[], 'value', 42, false, null]) {
      assert.throws(
        () => addContentTypeDiscriminator(output, 'application/json'),
        /content-type discriminator.*plain object/,
      );
    }
  });
});
