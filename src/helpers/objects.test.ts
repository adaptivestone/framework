import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPlainObject } from './objects.ts';

describe('isPlainObject', () => {
  it('accepts plain and null-prototype objects', () => {
    assert.strictEqual(isPlainObject({ a: 1 }), true);
    assert.strictEqual(isPlainObject(Object.create(null)), true);
  });

  it('rejects arrays, class instances and primitives', () => {
    for (const value of [
      [],
      new Date(0),
      new Error('x'),
      new Map(),
      null,
      'a',
      1,
      undefined,
    ]) {
      assert.strictEqual(isPlainObject(value), false);
    }
  });
});
