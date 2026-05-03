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
}

/**
 * Framework-owned validation error contract. The runtime class lands in
 * P1a-runtime — this interface is what handler catch-blocks (and the
 * top-level error boundary) read to surface field-keyed messages back
 * to the client.
 */
export interface ValidationError extends Error {
  readonly name: 'ValidationError';
  readonly issues: ReadonlyArray<ValidationIssue>;
}

/**
 * Legacy custom-validator escape hatch. Mirrors today's
 * `src/services/validate/drivers/CustomValidator.js` shape: a plain
 * object with `validate` (throws on failure) and `cast` (transforms
 * to typed output).
 *
 * Preserved during P1a-runtime so users with `request: { validate, cast }`
 * plain objects don't break on day one. Deprecation timeline TBD.
 */
export interface LegacyCustomValidator<Input = unknown, Output = Input> {
  readonly validate: (data: Input, ctx: unknown) => unknown | Promise<unknown>;
  readonly cast: (data: Input, ctx: unknown) => Output | Promise<Output>;
}

/**
 * The shape accepted as a route's `request` or `query` schema.
 * Standard Schema is canonical; `LegacyCustomValidator` is the
 * temporary escape hatch for existing custom validators.
 */
export type ValidatorBody = StandardSchemaV1 | LegacyCustomValidator;
