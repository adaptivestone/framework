import type {
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

  toJsonSchema() {
    return null;
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
    for (const message of messages) {
      issues.push({ message, path, params: inner.params });
    }
  }

  return new ValidationError(issues);
}
