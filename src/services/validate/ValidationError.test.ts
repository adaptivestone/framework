import { describe, expect, it } from 'vitest';
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
    expect(err.name).toBe('ValidationError');
    expect(err.message).toEqual({ email: ['required', 'too short'] });
    expect(err.issues).toEqual(issues);
  });

  it('builds from a payload object, normalizing string + array values to arrays', () => {
    const err = new ValidationError({
      email: 'required', // single string
      tags: ['a', 'b'], // array
    });
    // canonical .message is always-array, regardless of input form
    expect(err.message).toEqual({ email: ['required'], tags: ['a', 'b'] });
    // ...and .issues is the flattened canonical list (one per message)
    expect(err.issues).toEqual([
      { message: 'required', path: ['email'] },
      { message: 'a', path: ['tags'] },
      { message: 'b', path: ['tags'] },
    ]);
  });

  it('maps a root-level ("") payload key to a pathless issue', () => {
    const err = new ValidationError({ '': 'whole-body invalid' });
    expect(err.message).toEqual({ '': ['whole-body invalid'] });
    expect(err.issues).toEqual([
      { message: 'whole-body invalid', path: undefined },
    ]);
  });

  it('isValidationError is a cross-realm-safe duck check', () => {
    expect(ValidationError.isValidationError(new ValidationError([]))).toBe(
      true,
    );
    // a plain Error whose name was set (e.g. crossed a module boundary)
    const ducked = Object.assign(new Error(), { name: 'ValidationError' });
    expect(ValidationError.isValidationError(ducked)).toBe(true);
    expect(ValidationError.isValidationError(new Error('nope'))).toBe(false);
    expect(ValidationError.isValidationError({ name: 'ValidationError' })).toBe(
      false,
    );
  });
});

describe('issuesToPayload — cross-validator path rendering', () => {
  const render = (path: ValidationIssue['path']) =>
    Object.keys(issuesToPayload([{ message: 'x', path }]))[0];

  it('renders an empty / missing path as the root key ""', () => {
    expect(render(undefined)).toBe('');
    expect(render([])).toBe('');
  });

  it('dot-joins object keys', () => {
    expect(render(['name', 'first'])).toBe('name.first');
  });

  it('renders numeric segments (zod) as bracket indices', () => {
    expect(render(['tags', 1])).toBe('tags[1]');
  });

  it('renders numeric-string segments (yup) as bracket indices too', () => {
    expect(render(['tags', '2'])).toBe('tags[2]');
  });

  it('unwraps Standard-Schema `{ key }` path segments', () => {
    expect(render([{ key: 'name' }, { key: 0 }])).toBe('name[0]');
  });

  it('groups multiple messages under the same rendered path', () => {
    expect(
      issuesToPayload([
        { message: 'a', path: ['x'] },
        { message: 'b', path: ['x'] },
      ]),
    ).toEqual({ x: ['a', 'b'] });
  });
});
