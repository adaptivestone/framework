import type { StandardSchemaV1 } from './types.ts';

/**
 * Wrap a validate function into a Standard Schema object — zero dependencies.
 *
 * The `Output` generic is what the codegen reads for handler request types
 * (`StandardSchemaV1.InferOutput`): you declare it, the runtime checks live in
 * `validate`. Return only the known keys in the success `value` to strip
 * unknown input by construction.
 *
 * Use this for simple, dependency-free schemas. For richer validation, bring a
 * Standard Schema library (zod, valibot, arktype, yup ≥1.7) as a route schema —
 * the framework dispatches it the same way.
 *
 * @example
 * const loginSchema = defineSchema<{ email: string }>((value) => {
 *   const v = (value ?? {}) as Record<string, unknown>;
 *   if (typeof v.email !== 'string') {
 *     return { issues: [{ message: 'email required', path: ['email'] }] };
 *   }
 *   return { value: { email: v.email } };
 * });
 */
export function defineSchema<Output>(
  validate: (
    value: unknown,
  ) =>
    | StandardSchemaV1.Result<Output>
    | Promise<StandardSchemaV1.Result<Output>>,
): StandardSchemaV1<unknown, Output> {
  return { '~standard': { version: 1, vendor: 'framework', validate } };
}
