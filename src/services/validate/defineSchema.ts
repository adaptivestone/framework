import type { JsonSchema, StandardSchemaV1 } from './types.ts';

export interface DefineSchemaOptions {
  /**
   * Optional JSON Schema used by documentation generators. This keeps small
   * framework-owned validators dependency-free while still making their wire
   * shape available to OpenAPI. Every `toJsonSchema()` call returns a copy, so
   * a shared module-level object can't be mutated through a generated document.
   */
  jsonSchema?: JsonSchema | (() => JsonSchema);
}

export interface DefinedSchema<Output>
  extends StandardSchemaV1<unknown, Output> {
  readonly toJsonSchema?: () => JsonSchema;
}

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
 * }, {
 *   jsonSchema: {
 *     type: 'object',
 *     properties: { email: { type: 'string', format: 'email' } },
 *     required: ['email'],
 *   },
 * });
 */
export function defineSchema<Output>(
  validate: (
    value: unknown,
  ) =>
    | StandardSchemaV1.Result<Output>
    | Promise<StandardSchemaV1.Result<Output>>,
  options: DefineSchemaOptions = {},
): DefinedSchema<Output> {
  const schema: DefinedSchema<Output> = {
    '~standard': { version: 1, vendor: 'framework', validate },
  };
  if (options.jsonSchema) {
    const jsonSchema = options.jsonSchema;
    return {
      ...schema,
      toJsonSchema: () =>
        structuredClone(
          typeof jsonSchema === 'function' ? jsonSchema() : jsonSchema,
        ),
    };
  }
  return schema;
}
