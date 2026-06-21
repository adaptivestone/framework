import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { StandardSchemaV1 } from '../types.ts';
import { standardSchemaDriver } from './StandardSchemaDriver.ts';

// biome-ignore lint/suspicious/noExplicitAny: assertions read a loosely-typed JSON Schema
type AnyJson = any;

describe('standardSchemaDriver.toJsonSchema', () => {
  it('converts a zod schema via native z.toJSONSchema', async () => {
    const schema = z.object({
      email: z.string().email(),
      age: z.number().int().min(0).max(120).optional(),
    });

    const json = (await standardSchemaDriver.toJsonSchema?.(schema)) as AnyJson;

    expect(json.type).toBe('object');
    expect(json.properties.email).toMatchObject({
      type: 'string',
      format: 'email',
    });
    expect(json.properties.age).toMatchObject({
      type: 'integer',
      minimum: 0,
      maximum: 120,
    });
    expect(json.required).toEqual(['email']);
  });

  it('prefers a native .toJsonSchema() method when present (arktype-style)', async () => {
    const sentinel = { type: 'string', format: 'custom' };
    const schema = {
      '~standard': {
        version: 1,
        vendor: 'custom',
        validate: () => ({ value: '' }),
      },
      toJsonSchema: () => sentinel,
    } as unknown as StandardSchemaV1;

    const json = await standardSchemaDriver.toJsonSchema?.(schema);

    expect(json).toBe(sentinel);
  });

  it('returns null for a vendor with no introspection (e.g. valibot-like)', async () => {
    const schema = {
      '~standard': {
        version: 1,
        vendor: 'valibot',
        validate: () => ({ value: '' }),
      },
    } as unknown as StandardSchemaV1;

    expect(await standardSchemaDriver.toJsonSchema?.(schema)).toBeNull();
  });
});
