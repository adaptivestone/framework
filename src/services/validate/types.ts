/**
 * Validator type contracts.
 *
 * Standard Schema v1 spec types are inlined from https://standardschema.dev to
 * avoid a runtime dependency. Any conforming schema (yup ≥1.7, zod ≥3.24,
 * valibot, arktype, ...) plugs in as a route's `request` or `query` schema.
 *
 * If the upstream spec evolves, mirror it here.
 */

/**
 * Spec interface implemented by Standard Schema-compliant validators.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
      options?: Options | undefined,
    ) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  export interface Options {
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  export interface PathSegment {
    readonly key: PropertyKey;
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['input'];

  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['output'];
}

/**
 * One validation issue surfaced to the consumer. Shape mirrors
 * `StandardSchemaV1.Issue` so iterating issues from a `ValidationError`
 * works the same regardless of the underlying validator.
 */
export interface ValidationIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
  /**
   * Extra context for message interpolation (e.g., yup populates `min`,
   * `max`, `length` for those validators). Passed to `t(message, fallback,
   * params)` when the framework auto-translates so i18n placeholders
   * like `{{min}}` resolve to actual values.
   */
  readonly params?: Record<string, unknown>;
}

/**
 * Framework-owned validation error contract. The runtime class is in
 * `./ValidationError.ts`. This interface is what handler catch-blocks
 * (and the top-level error boundary) read to surface field-keyed
 * messages back to the client.
 */
export interface ValidationError extends Error {
  readonly name: 'ValidationError';
  readonly issues: ReadonlyArray<ValidationIssue>;
}

/**
 * JSON Schema document. Loose typing; downstream consumers (e.g., an
 * OpenAPI generator) refine to a stricter shape.
 */
export type JsonSchema = Record<string, unknown>;

/**
 * A pluggable validator driver. The framework dispatches one driver
 * per route schema; drivers handle vendor-specific quirks (yup's
 * `stripUnknown` post-process, native JSON Schema export, etc.).
 *
 * Built-in drivers live in `./drivers/`. Users register their own via
 * `ValidateService.register(driver)` to support non-Standard-Schema
 * validators (raw Joi, custom shapes, ...).
 *
 * Concerns:
 * - Runtime validation + cast    →  `validate`
 * - JSON Schema for OpenAPI      →  `toJsonSchema?` (optional)
 * - Compile-time TS types        →  schema-side, not driver — see `StandardSchemaV1.InferOutput`
 */
export interface ValidatorDriver {
  /** Sync dispatch; should be a fast property check. */
  canHandle(body: unknown): boolean;
  /** Validate + cast. Returns the cast value on success; throws `ValidationError` on failure. */
  validate(body: unknown, data: unknown): Promise<unknown>;
  /**
   * Optional: emit JSON Schema (draft 2020-12, for OpenAPI 3.1). Returns null
   * when introspection isn't supported. May be async — vendor exporters (e.g.
   * zod's `z.toJSONSchema`) are reached via a lazy `import()` so the lib stays
   * an optional peer.
   */
  toJsonSchema?(body: unknown): JsonSchema | null | Promise<JsonSchema | null>;
}
