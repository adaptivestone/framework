import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { array, boolean, date, number, object, ref, string } from 'yup';
import { assertTextMatch } from '../../../tests/assertions.ts';
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

  it('reports the other fields next to a list sent to a trimmed string', async () => {
    const schema = object({
      name: string().trim().required(),
      email: string().required(),
    });

    const err = await rejection(schema, { name: ['a', 'b'], email: undefined });
    const plain = await rejection(schema, { name: 'a' });

    assert.ok(ValidationError.isValidationError(err));
    assert.ok(ValidationError.isValidationError(plain));
    assert.deepStrictEqual(
      err.issues.map((issue) => issue.path),
      [['name'], ['email']],
    );
    // `email` is reported exactly as a normal validation reports it.
    assert.deepStrictEqual(err.issues[1], plain.issues[0]);
  });

  it('reports nested and indexed paths without changing the input', async () => {
    const schema = object({
      profile: object({
        city: string().trim().required(),
        zip: string().required(),
      }),
      items: array(
        object({
          label: string().lowercase().required(),
          qty: number().required(),
        }),
      ),
      'a.b': string().trim(),
    });
    const data = {
      profile: { city: { x: 1 } },
      items: [{ label: 'ok', qty: '3' }, { label: ['x'] }],
      'a.b': ['y'],
    };

    const err = await rejection(schema, data);

    assert.ok(ValidationError.isValidationError(err));
    assert.deepStrictEqual(err.issues.map((issue) => issue.path).sort(), [
      ['["a.b"]'],
      ['items[1].label'],
      ['items[1].qty'],
      ['profile.city'],
      ['profile.zip'],
    ]);
    assert.deepStrictEqual(data, {
      profile: { city: { x: 1 } },
      items: [{ label: 'ok', qty: '3' }, { label: ['x'] }],
      'a.b': ['y'],
    });
  });

  it('reports only the list when the rest is valid, castable values and uploads included', async () => {
    class Upload {}
    const schema = object({
      name: string().trim().required(),
      age: number().required(),
      upload: array()
        .required()
        .test('files', 'not a file', (files) =>
          (files ?? []).every((file) => file instanceof Upload),
        ),
    });

    const err = await rejection(schema, {
      name: ['a'],
      age: '42',
      upload: [new Upload()],
    });

    assert.ok(ValidationError.isValidationError(err));
    assert.deepStrictEqual(
      err.issues.map((issue) => issue.path),
      [['name']],
    );
  });

  it('still answers a list in a field whose path cannot be followed', async () => {
    const schema = object({ 'tags[]': string().trim(), email: string() });

    const err = await rejection(schema, { 'tags[]': ['a'] });

    assert.ok(ValidationError.isValidationError(err));
    assert.deepStrictEqual(
      err.issues.map((issue) => issue.path),
      [['tags[]']],
    );
  });

  it('answers many rejected items without slowing down per item', async () => {
    const schema = object({ items: array(string().trim().required()) });
    const items = Array.from({ length: 20_000 }, () => []);

    const started = performance.now();
    const err = await rejection(schema, { items });
    const elapsed = performance.now() - started;

    assert.ok(ValidationError.isValidationError(err));
    assert.strictEqual(err.issues.length, 20_000);
    // A few seconds at most; work that grows with the square of the list
    // takes about a minute here.
    assert.ok(elapsed < 8000, `took ${Math.round(elapsed)} ms`);
  });

  it('answers the list alone when the re-check throws', async () => {
    const schema = object({
      name: string().trim().required(),
      nick: string().test(
        'reads-name',
        'needs a name',
        // Assumes the sibling is set: throws once the list is taken out.
        function () {
          return (this.parent as { name: string[] }).name.length > 0;
        },
      ),
    });

    const err = await rejection(schema, { name: ['a'], nick: 'n' });

    assert.ok(ValidationError.isValidationError(err));
    assert.deepStrictEqual(
      err.issues.map((issue) => issue.path),
      [['name']],
    );
  });

  it('does not carry one validation input into the next', async () => {
    const schema = object({ age: number() });

    await rejection(schema, { age: 'first-input' });
    const err = await rejection(schema, { age: 'second-input' });

    assert.ok(ValidationError.isValidationError(err));
    assertTextMatch(err.issues[0].message, /second-input/);
    assert.doesNotMatch(JSON.stringify(err.issues), /first-input/);
  });

  it('still trims a valid string', async () => {
    const schema = object({ phone: string().trim().required() });

    assert.deepStrictEqual(
      await yupDriver.validate(schema, { phone: ' 555 ' }),
      { phone: '555' },
    );
  });
});
