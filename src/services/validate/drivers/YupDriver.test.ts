import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { array, boolean, date, number, object, string } from 'yup';
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
