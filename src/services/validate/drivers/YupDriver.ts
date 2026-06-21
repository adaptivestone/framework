import type {
  JsonSchema,
  StandardSchemaV1,
  ValidationIssue,
  ValidatorDriver,
} from '../types.ts';
import { ValidationError } from '../ValidationError.ts';

/**
 * Yup-vendor driver. Handles `body['~standard'].vendor === 'yup'`.
 *
 * Two yup-specific behaviors that the generic Standard Schema driver
 * doesn't cover:
 *
 * 1. **Strip unknown.** Yup's `~standard.validate(data)` does NOT strip
 *    unknown fields. Today's framework calls `cast(data, {stripUnknown: true})`
 *    explicitly. To preserve that behavior — and avoid a security
 *    regression in handlers that spread `req.appInfo.request` into
 *    `Model.create(...)` — this driver calls yup's native validate with
 *    `{ stripUnknown: true, abortEarly: false }` directly. One call:
 *    validates + casts + strips, throws on issues.
 *
 * 2. **Error translation.** Yup throws its own `ValidationError` with
 *    `.inner[]` (one entry per failed field) and `.errors[]` (messages).
 *    We translate to the framework's `ValidationError` via duck-typing
 *    (no top-level yup import — keeps the framework runtime decoupled).
 */
export const yupDriver: ValidatorDriver = {
  canHandle(body: unknown): boolean {
    return (
      typeof body === 'object' &&
      body !== null &&
      '~standard' in body &&
      (body as StandardSchemaV1)['~standard']?.vendor === 'yup'
    );
  },

  async validate(body: unknown, data: unknown): Promise<unknown> {
    type YupSchemaLike = {
      validate: (
        data: unknown,
        opts: { stripUnknown: boolean; abortEarly: boolean },
      ) => Promise<unknown>;
    };
    try {
      return await (body as YupSchemaLike).validate(data, {
        stripUnknown: true,
        abortEarly: false,
      });
    } catch (e: unknown) {
      if (isYupValidationError(e)) {
        throw fromYupError(e);
      }
      throw e;
    }
  },

  toJsonSchema(body: unknown): JsonSchema | null {
    const describe = (body as { describe?: () => YupDescription }).describe;
    if (typeof describe !== 'function') {
      return null;
    }
    try {
      return describeToJsonSchema(describe.call(body));
    } catch {
      // A non-introspectable yup shape (custom test, exotic transform) should
      // degrade to a placeholder upstream, never throw mid-generation.
      return null;
    }
  },
};

interface YupValidationErrorShape {
  name: string;
  message: string;
  path?: string;
  errors?: string[];
  inner?: YupValidationErrorShape[];
  params?: Record<string, unknown>;
}

function isYupValidationError(e: unknown): e is YupValidationErrorShape {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name === 'ValidationError' &&
    Array.isArray((e as { inner?: unknown }).inner)
  );
}

function fromYupError(e: YupValidationErrorShape): ValidationError {
  const issues: ValidationIssue[] = [];
  const inners = Array.isArray(e.inner) && e.inner.length > 0 ? e.inner : [e];

  for (const inner of inners) {
    const path: ValidationIssue['path'] = inner.path ? [inner.path] : undefined;
    const messages = Array.isArray(inner.errors)
      ? inner.errors
      : [inner.message];
    const params = sanitizeParams(inner.params);
    for (const message of messages) {
      issues.push({ message, path, params });
    }
  }

  return new ValidationError(issues);
}

/**
 * Drop the raw submitted input from yup's `params`. Yup echoes the offending
 * value back in `value`/`originalValue`; surfacing it on `.issues` would leak
 * the rejected input (e.g. a password) into anything that iterates issues for
 * logging/observability. The interpolation params (`min`, `max`, `length`, …)
 * are kept so i18n placeholders still resolve.
 */
function sanitizeParams(
  params?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!params) {
    return undefined;
  }
  const { value, originalValue, ...safe } = params;
  return safe;
}

// ── yup `describe()` → JSON Schema (draft 2020-12, for OpenAPI 3.1) ────────────
// Standard Schema carries no shape, so the yup driver introspects via yup's own
// `schema.describe()` (sync). Covers the common cases; un-mappable shapes fall
// back to a permissive `{}` so generation never breaks.

interface YupTest {
  name?: string;
  params?: Record<string, unknown>;
}

interface YupDescription {
  type: string;
  label?: string;
  meta?: Record<string, unknown> | null;
  oneOf?: unknown[];
  nullable?: boolean;
  optional?: boolean;
  default?: unknown;
  tests?: YupTest[];
  fields?: Record<string, YupDescription>;
  innerType?: YupDescription | YupDescription[];
}

function describeToJsonSchema(desc: YupDescription): JsonSchema {
  const schema = mapYupType(desc);
  if (Array.isArray(desc.oneOf) && desc.oneOf.length > 0) {
    schema.enum = [...desc.oneOf];
  }
  // yup stamps every object with `default: {}` — an artifact, not author intent.
  // Keep meaningful scalar/array defaults; drop the container noise.
  if (desc.default !== undefined && desc.type !== 'object') {
    schema.default = desc.default;
  }
  const description =
    desc.meta && typeof desc.meta.description === 'string'
      ? desc.meta.description
      : desc.label;
  if (description) {
    schema.description = description;
  }
  return applyNullable(schema, desc);
}

function mapYupType(desc: YupDescription): JsonSchema {
  switch (desc.type) {
    case 'object': {
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(desc.fields ?? {})) {
        properties[key] = describeToJsonSchema(field);
        if (isRequired(field)) {
          required.push(key);
        }
      }
      const out: JsonSchema = { type: 'object', properties };
      if (required.length > 0) {
        out.required = required;
      }
      return out;
    }
    case 'array': {
      const inner = Array.isArray(desc.innerType)
        ? desc.innerType[0]
        : desc.innerType;
      return {
        type: 'array',
        items: inner ? describeToJsonSchema(inner) : {},
      };
    }
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: hasTest(desc, 'integer') ? 'integer' : 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return { type: 'string', format: 'date-time' };
    case 'file':
      return { type: 'string', format: 'binary' };
    default:
      // 'mixed', 'lazy', 'tuple', or unknown → permissive (any).
      return {};
  }
}

function isRequired(desc: YupDescription): boolean {
  if (desc.optional === false) {
    return true;
  }
  return hasTest(desc, 'required') || hasTest(desc, 'defined');
}

function hasTest(desc: YupDescription, name: string): boolean {
  return Array.isArray(desc.tests) && desc.tests.some((t) => t?.name === name);
}

// draft 2020-12: a nullable scalar becomes a `[type, 'null']` union.
function applyNullable(schema: JsonSchema, desc: YupDescription): JsonSchema {
  if (!desc.nullable) {
    return schema;
  }
  if (typeof schema.type === 'string') {
    return { ...schema, type: [schema.type, 'null'] };
  }
  return schema;
}
