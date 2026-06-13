import type { StandardSchemaV1, ValidatorDriver } from '../types.ts';
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
 * `toJsonSchema` returns null here; per-vendor drivers can override
 * with their own native exporters when OpenAPI export is needed.
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

  toJsonSchema() {
    return null;
  },
};
