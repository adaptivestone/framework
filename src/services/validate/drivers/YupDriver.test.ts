import { describe, expect, it } from 'vitest';
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

    expect(json).toEqual({
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

    expect(json.properties.tags).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
    expect(json.properties.role).toEqual({
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

    expect(json.properties.created).toEqual({
      type: 'string',
      format: 'date-time',
    });
    expect(json.properties.name.description).toBe('the name');
  });

  it('represents nullable as a [type, null] union by default (OAS 3.1)', () => {
    const schema = object({ nick: string().nullable() });

    const json = yupDriver.toJsonSchema?.(schema) as AnyJson;

    expect(json.properties.nick.type).toEqual(['string', 'null']);
  });

  it('returns null for a non-yup value (no describe)', () => {
    expect(yupDriver.toJsonSchema?.({})).toBeNull();
  });
});
