import type {
  JsonSchema,
  StandardSchemaV1,
  ValidatorDriver,
} from '../types.ts';
import { ValidationError } from '../ValidationError.ts';

/**
 * Generic Standard Schema driver. Handles any validator that implements
 * the `~standard` interface (zod ≥3.24, valibot, arktype, custom user
 * Standard-Schema-conformant shapes — and yup, when no more-specific
 * driver is registered).
 *
 * Most popular libs strip unknown fields by default in their Standard
 * Schema validate (zod, valibot, arktype). Yup is the outlier — see
 * `YupDriver.ts` for the strip-preserving fast path.
 *
 * `toJsonSchema` is vendor-generic: Standard Schema itself carries no shape, so
 * conversion delegates to each lib's native exporter — a `.toJsonSchema()`
 * method on the schema (arktype, …), else zod's `z.toJSONSchema` (lazy-imported
 * so zod stays an optional peer). Vendors with no introspection return null and
 * the caller (OpenAPI generator) degrades to a placeholder.
 */
export const standardSchemaDriver: ValidatorDriver = {
  canHandle(body: unknown): boolean {
    return (
      typeof body === 'object' &&
      body !== null &&
      '~standard' in body &&
      typeof (body as Partial<StandardSchemaV1>)['~standard'] === 'object'
    );
  },

  async validate(body: unknown, data: unknown): Promise<unknown> {
    const std = (body as StandardSchemaV1)['~standard'];
    const result = await std.validate(data);
    // Per the Standard Schema spec, success is signalled by absent `issues`; a
    // non-conformant validator returning an empty `issues: []` is not a failure,
    // so don't reject a valid `value` with an empty ValidationError. (An empty
    // `issues` array keeps `result` typed as a failure, hence the `value` read.)
    if (result.issues && result.issues.length > 0) {
      throw new ValidationError(result.issues);
    }
    return (result as { value?: unknown }).value;
  },

  async toJsonSchema(body: unknown): Promise<JsonSchema | null> {
    // 1. A native instance method (arktype's `.toJsonSchema()`, and any future
    //    lib that exposes one). Covers the general case without a per-vendor branch.
    const native = (body as { toJsonSchema?: unknown }).toJsonSchema;
    if (typeof native === 'function') {
      return (native as () => JsonSchema).call(body);
    }

    // 2. zod (≥4) — converter lives on the `zod` module, not the schema. Lazy
    //    import keeps zod an optional peer; only reached when a zod schema is used.
    const vendor = (body as StandardSchemaV1)['~standard']?.vendor;
    if (vendor === 'zod') {
      const mod = (await import('zod')) as unknown as {
        toJSONSchema?: ZodToJsonSchema;
        z?: { toJSONSchema?: ZodToJsonSchema };
      };
      const toJSONSchema = mod.toJSONSchema ?? mod.z?.toJSONSchema;
      if (typeof toJSONSchema === 'function') {
        // draft-2020-12 is what OpenAPI 3.1 expects.
        return toJSONSchema(body, { target: 'draft-2020-12' });
      }
    }

    // 3. valibot / older zod / anything else with no introspection → degrade.
    return null;
  },
};

type ZodToJsonSchema = (
  schema: unknown,
  opts?: { target?: string },
) => JsonSchema;
