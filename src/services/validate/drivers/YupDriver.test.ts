import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { array, boolean, date, number, object, ref, string } from 'yup';
import { ValidationError } from '../ValidationError.ts';
import { yupDriver } from './YupDriver.ts';

// biome-ignore lint/suspicious/noExplicitAny: assertions read a loosely-typed JSON Schema
type AnyJson = any;

describe('yupDriver.toJsonSchema', () => {
  it('maps an object schema with required + scalar fields', () => {
    const schema = object({
      name: string().required(),
      age: number().integer(),
      agree: boolean(),
    });

    const json = yupDriver.toJsonSchema?.(schema);

    assert.deepStrictEqual(json, {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
        agree: { type: 'boolean' },
      },
      required: ['name'],
    });
  });

  it('maps arrays via innerType and enums via oneOf', () => {
    const schema = object({
      tags: array(string()),
      role: string().oneOf(['admin', 'user']),
    });

    const json = yupDriver.toJsonSchema?.(schema) as AnyJson;

    assert.deepStrictEqual(json.properties.tags, {
      type: 'array',
      items: { type: 'string' },
    });
    assert.deepStrictEqual(json.properties.role, {
      type: 'string',
      enum: ['admin', 'user'],
    });
  });

  it('carries meta.description and maps date → date-time', () => {
    const schema = object({
      created: date(),
      name: string().meta({ description: 'the name' }),
    });

    const json = yupDriver.toJsonSchema?.(schema) as AnyJson;

    assert.deepStrictEqual(json.properties.created, {
      type: 'string',
      format: 'date-time',
    });
    assert.strictEqual(json.properties.name.description, 'the name');
  });

  it('represents nullable as a [type, null] union by default (OAS 3.1)', () => {
    const schema = object({ nick: string().nullable() });

    const json = yupDriver.toJsonSchema?.(schema) as AnyJson;

    assert.deepStrictEqual(json.properties.nick.type, ['string', 'null']);
  });

  it('returns null for a non-yup value (no describe)', () => {
    assert.strictEqual(yupDriver.toJsonSchema?.({}), null);
  });
});

const rejection = (schema: unknown, data: unknown) =>
  yupDriver.validate(schema, data).then(
    () => assert.fail('expected the validation to reject'),
    (e: unknown) => e,
  );

describe('yupDriver.validate', () => {
  it('keeps the values that ref() resolves out of issue params', async () => {
    const schema = object({
      password: string(),
      repeatPassword: string().oneOf([ref('password')]),
      old: string(),
      next: string().notOneOf([ref('old')]),
    });

    const err = await rejection(schema, {
      password: 'secret-pw',
      repeatPassword: 'typo-pw',
      old: 'old-pw',
      next: 'old-pw',
    });

    assert.ok(ValidationError.isValidationError(err));
    assert.doesNotMatch(JSON.stringify(err.issues), /secret-pw|typo-pw|old-pw/);
    // `values` describes the ref, so messages still render.
    assert.deepStrictEqual(
      err.issues.map((issue) => issue.params),
      [
        { label: undefined, path: 'repeatPassword', values: 'Ref(password)' },
        { label: undefined, path: 'next', values: 'Ref(old)' },
      ],
    );
  });

  it('answers an array or object in a transformed string field with type issues', async () => {
    const schema = object({
      phone: string().trim().required(),
      email: string().lowercase(),
      age: number(),
    });

    const err = await rejection(schema, {
      phone: ['555'],
      email: { a: 1 },
      age: '42',
    });

    assert.ok(ValidationError.isValidationError(err));
    // Only the array/object type errors: `age: '42'` casts outside strict mode.
    assert.deepStrictEqual(
      err.issues.map((issue) => issue.path),
      [['phone'], ['email']],
    );
    for (const issue of err.issues) {
      assert.ok(issue.params && !('value' in issue.params));
    }
  });

  it('rethrows the original error when a custom test throws', async () => {
    let calls = 0;
    const schema = object({
      phone: string()
        .trim()
        .test('lookup', 'lookup failed', () => {
          calls += 1;
          throw new Error(`outage ${calls}`);
        }),
    });

    const err = await rejection(schema, { phone: '555' });

    assert.ok(err instanceof Error);
    assert.strictEqual(err.message, 'outage 1');
    // Not a TypeError, so no strict re-check runs the lookup again.
    assert.strictEqual(calls, 1);
  });

  it('rethrows the original TypeError when no array or object caused it', async () => {
    let calls = 0;
    const schema = object({
      phone: string().test('lookup', 'lookup failed', () => {
        calls += 1;
        throw new TypeError(`fetch failed ${calls}`);
      }),
    });

    const err = await rejection(schema, { phone: '555' });

    assert.ok(err instanceof TypeError);
    assert.strictEqual(err.message, 'fetch failed 1');
  });

  it('still trims a valid string', async () => {
    const schema = object({ phone: string().trim().required() });

    assert.deepStrictEqual(
      await yupDriver.validate(schema, { phone: ' 555 ' }),
      { phone: '555' },
    );
  });
});
