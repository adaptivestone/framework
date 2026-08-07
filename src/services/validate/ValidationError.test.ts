import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ValidationIssue } from './types.ts';
import { issuesToPayload, ValidationError } from './ValidationError.ts';

/**
 * `ValidationError` is the framework's wire-format for validation failures:
 * `res.json({ errors: err.message })` serializes `.message` (a path-keyed
 * payload), while `.issues` is the canonical list. The path renderer must
 * normalize zod-style numeric segments and yup-style pre-baked brackets to the
 * SAME string, so a consumer sees identical bytes regardless of validator.
 */
describe('ValidationError', () => {
  it('builds from an issues array → array-valued payload + issues kept', () => {
    const issues: ValidationIssue[] = [
      { message: 'required', path: ['email'] },
      { message: 'too short', path: ['email'] },
    ];
    const err = new ValidationError(issues);
    assert.strictEqual(err.name, 'ValidationError');
    assert.deepStrictEqual(err.message, { email: ['required', 'too short'] });
    assert.deepStrictEqual(err.issues, issues);
  });

  it('builds from a payload object, normalizing string + array values to arrays', () => {
    const err = new ValidationError({
      email: 'required', // single string
      tags: ['a', 'b'], // array
    });
    // canonical .message is always-array, regardless of input form
    assert.deepStrictEqual(err.message, {
      email: ['required'],
      tags: ['a', 'b'],
    });
    // ...and .issues is the flattened canonical list (one per message)
    assert.deepStrictEqual(err.issues, [
      { message: 'required', path: ['email'] },
      { message: 'a', path: ['tags'] },
      { message: 'b', path: ['tags'] },
    ]);
  });

  it('maps a root-level ("") payload key to a pathless issue', () => {
    const err = new ValidationError({ '': 'whole-body invalid' });
    assert.deepStrictEqual(err.message, { '': ['whole-body invalid'] });
    assert.deepStrictEqual(err.issues, [
      { message: 'whole-body invalid', path: undefined },
    ]);
  });

  it('isValidationError is a cross-realm-safe duck check', () => {
    assert.strictEqual(
      ValidationError.isValidationError(new ValidationError([])),
      true,
    );
    // a plain Error whose name was set (e.g. crossed a module boundary)
    const ducked = Object.assign(new Error(), { name: 'ValidationError' });
    assert.strictEqual(ValidationError.isValidationError(ducked), true);
    assert.strictEqual(
      ValidationError.isValidationError(new Error('nope')),
      false,
    );
    assert.strictEqual(
      ValidationError.isValidationError({ name: 'ValidationError' }),
      false,
    );
  });
});

describe('issuesToPayload — cross-validator path rendering', () => {
  const render = (path: ValidationIssue['path']) =>
    Object.keys(issuesToPayload([{ message: 'x', path }]))[0];

  it('renders an empty / missing path as the root key ""', () => {
    assert.strictEqual(render(undefined), '');
    assert.strictEqual(render([]), '');
  });

  it('dot-joins object keys', () => {
    assert.strictEqual(render(['name', 'first']), 'name.first');
  });

  it('renders numeric segments (zod) as bracket indices', () => {
    assert.strictEqual(render(['tags', 1]), 'tags[1]');
  });

  it('renders numeric-string segments (yup) as bracket indices too', () => {
    assert.strictEqual(render(['tags', '2']), 'tags[2]');
  });

  it('unwraps Standard-Schema `{ key }` path segments', () => {
    assert.strictEqual(render([{ key: 'name' }, { key: 0 }]), 'name[0]');
  });

  it('groups multiple messages under the same rendered path', () => {
    assert.deepStrictEqual(
      issuesToPayload([
        { message: 'a', path: ['x'] },
        { message: 'b', path: ['x'] },
      ]),
      { x: ['a', 'b'] },
    );
  });
});
