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
    try {
      return await (body as YupSchemaLike).validate(data, validateOptions());
    } catch (e: unknown) {
      if (isYupValidationError(e)) {
        throw fromYupError(e);
      }
      if (e instanceof TypeError) {
        throw (await shapeTypeErrors(body as YupSchemaLike, data)) ?? e;
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

// A new object per call: yup writes its state (`originalValue`, …) into it.
const validateOptions = () => ({ stripUnknown: true, abortEarly: false });

type YupSchemaLike = {
  validate: (
    data: unknown,
    opts: { stripUnknown?: boolean; abortEarly: boolean; strict?: boolean },
  ) => Promise<unknown>;
};

interface YupValidationErrorShape {
  name: string;
  message: string;
  path?: string;
  type?: string;
  value?: unknown;
  errors?: string[];
  inner?: YupValidationErrorShape[];
  params?: Record<string, unknown>;
}

/**
 * A transform that assumes its type (`string().trim()`, `.lowercase()`) throws
 * a `TypeError` when a client sends an array or object. A check without
 * transforms finds those values; the normal validation then runs again with
 * them taken out, for the other fields' issues. Anything else (e.g. a `.test()`
 * that throws) yields `undefined`, so the caller rethrows its original error.
 */
async function shapeTypeErrors(
  schema: YupSchemaLike,
  data: unknown,
): Promise<ValidationError | undefined> {
  let strictError: YupValidationErrorShape;
  try {
    await schema.validate(data, { strict: true, abortEarly: false });
    return undefined;
  } catch (e: unknown) {
    if (!isYupValidationError(e)) {
      return undefined;
    }
    strictError = e;
  }
  // Strict mode also rejects castable input (`'42'` for `number()`), so keep
  // only the values no cast accepts.
  const typeIssues = leafErrors(strictError).filter(
    (issue) => issue.type === 'typeError' && isArrayOrPlainObject(issue.value),
  );
  if (typeIssues.length === 0) {
    return undefined;
  }
  const answer = (inner: YupValidationErrorShape[]) =>
    fromYupError({ ...strictError, inner });

  const copies = new WeakSet<object>();
  let rest = data;
  for (const issue of typeIssues) {
    const next = withoutValue(rest, issue.path ?? '', issue.value, copies);
    if (!next) {
      // A path that cannot be followed (a key such as `tags[]`): the type
      // issues alone still answer 400.
      return answer(typeIssues);
    }
    rest = next.data;
  }
  try {
    await schema.validate(rest, validateOptions());
  } catch (e: unknown) {
    // Any other failure (a test or transform that needed a removed value)
    // leaves the type issues alone to answer.
    if (isYupValidationError(e)) {
      const typePaths = new Set(typeIssues.map((issue) => issue.path ?? ''));
      const others = leafErrors(e).filter(
        (issue) => !isAtOrUnder(issue.path ?? '', typePaths),
      );
      return answer([...typeIssues, ...others]);
    }
  }
  return answer(typeIssues);
}

function leafErrors(e: YupValidationErrorShape): YupValidationErrorShape[] {
  return Array.isArray(e.inner) && e.inner.length > 0 ? e.inner : [e];
}

/** Yup paths: `a.b`, `a[0]`, `a["key.with.dots"]`; `''` is the root. */
function isAtOrUnder(path: string, parents: Set<string>): boolean {
  if (parents.has('') || parents.has(path)) {
    return true;
  }
  for (let i = 0; i < path.length; i += 1) {
    if ((path[i] === '.' || path[i] === '[') && parents.has(path.slice(0, i))) {
      return true;
    }
  }
  return false;
}

const PATH_SEGMENT = /\["(.*?)"\]|\[(\d+)\]|\.?([^.[]+)/y;

/**
 * `data` with the value at a yup `path` set to `undefined` (transforms skip
 * it), copying only the containers on the way: a deep clone would turn
 * uploads (class instances) into plain objects. A container in `copies` is
 * already a copy and is reused, so each one is copied once. `undefined` when
 * the path does not lead to `expected`.
 */
function withoutValue(
  data: unknown,
  path: string,
  expected: unknown,
  copies: WeakSet<object>,
): { data: unknown } | undefined {
  const segments: string[] = [];
  PATH_SEGMENT.lastIndex = 0;
  while (PATH_SEGMENT.lastIndex < path.length) {
    const match = PATH_SEGMENT.exec(path);
    if (!match) {
      return undefined;
    }
    segments.push(match[1] ?? match[2] ?? match[3]);
  }
  if (segments.length === 0) {
    return data === expected ? { data: undefined } : undefined;
  }
  const root = copyContainer(data, copies);
  let container = root;
  for (const [i, key] of segments.entries()) {
    if (!container || !Object.hasOwn(container, key)) {
      return undefined;
    }
    if (i === segments.length - 1) {
      if (container[key] !== expected) {
        return undefined;
      }
      container[key] = undefined;
    } else {
      const child = copyContainer(container[key], copies);
      container[key] = child;
      container = child;
    }
  }
  return { data: root };
}

function copyContainer(
  value: unknown,
  copies: WeakSet<object>,
): Record<string, unknown> | undefined {
  if (!isArrayOrPlainObject(value)) {
    return undefined;
  }
  if (copies.has(value as object)) {
    return value as Record<string, unknown>;
  }
  const copy = (
    Array.isArray(value) ? [...value] : { ...(value as object) }
  ) as Record<string, unknown>;
  copies.add(copy);
  return copy;
}

function isArrayOrPlainObject(value: unknown): boolean {
  if (Array.isArray(value)) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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
 * Drop submitted input from yup's `params`. Yup echoes the offending value in
 * `value`/`originalValue`, and `oneOf`/`notOneOf` put the values a `ref()`
 * resolves to (e.g. the password a `repeatPassword` must match) in `resolved`;
 * surfacing them on `.issues` would leak input into anything that logs issues.
 * `spec`/`disableStackTrace` are schema internals. The interpolation params
 * (`min`, `max`, `length`, `values`, …) are kept so i18n placeholders resolve.
 */
function sanitizeParams(
  params?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!params) {
    return undefined;
  }
  const { value, originalValue, resolved, spec, disableStackTrace, ...safe } =
    params;
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
