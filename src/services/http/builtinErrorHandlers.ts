import mongoose from 'mongoose';
import type { FrameworkRequest } from './HttpServer.ts';
import { HttpError } from './httpErrors.ts';

/** Levels the registry may log a handled error at (winston leveled methods). */
export type ErrorLogLevel =
  | 'error'
  | 'warn'
  | 'info'
  | 'http'
  | 'verbose'
  | 'debug'
  | 'silly';

/** What a handler returns to produce a response; `null`/`undefined` = pass. */
export interface ErrorHandlerResult {
  status: number;
  body: unknown;
}

export type ErrorHandlerFn<E extends Error = Error> = (
  err: E,
  req: FrameworkRequest,
) =>
  | ErrorHandlerResult
  | null
  | undefined
  | Promise<ErrorHandlerResult | null | undefined>;

/** A registered (class, handler, level) triple as stored by the registry. */
export interface RegisteredErrorHandler {
  errorClass: abstract new (...args: never[]) => Error;
  handler: ErrorHandlerFn;
  logLevel: ErrorLogLevel;
}

type MongooseFieldError =
  | mongoose.Error.ValidatorError
  | mongoose.Error.CastError;

/**
 * Mongoose spreads the schema-defined constraint onto a `ValidatorError`'s
 * `properties` at runtime (`maxlength: 255`, `min: 18`, `enumValues: [...]`, …),
 * but its published type only declares `{ message, type, path, value, reason }`.
 * Those extra keys are schema CONSTANTS (the bound the model was built with),
 * never the value the client submitted — so surfacing them cannot leak input.
 * We narrow to just the ones we render.
 */
interface ValidatorConstraintProperties {
  min?: unknown;
  max?: unknown;
  minlength?: unknown;
  maxlength?: unknown;
  enumValues?: readonly unknown[];
}

/** A numeric/Date schema bound (both are constants, never input) → text. */
function renderBound(bound: unknown): string | undefined {
  if (typeof bound === 'number') {
    return String(bound);
  }
  if (bound instanceof Date) {
    return bound.toISOString();
  }
  return undefined;
}

/**
 * Build a client-safe message for one failing Mongoose path, rebuilt from the
 * error's STRUCTURED fields (`kind` + the constraint on `properties`) only —
 * never from `err.message`. Mongoose's default templates interpolate the
 * rejected `{VALUE}` (`Path \`title\` (\`<300 chars>\`) is longer than …`,
 * `Cast to Number failed for value "<PII>" …`), so echoing `.message` would
 * leak the submission into the 400 body AND the warn-level log. Rebuilding from
 * `kind` mirrors the `YupDriver`, which strips `value`/`originalValue` for the
 * same reason.
 *
 * Model-defined CUSTOM messages (`maxlength: [50, 'Name too long']`) are NOT
 * passed through: a custom string is indistinguishable from a templated default
 * that embedded the value, so ALL messages are rebuilt generically. Deliberate
 * trade-off — the route validator owns user-facing/i18n wording; this is only a
 * last-resort fallback for a schema gap, and plain English by design.
 */
function safeValidationMessage(error: MongooseFieldError): string {
  // CastError: `kind` is the target type the value could not become (mixed
  // casing at runtime — `Number`, `ObjectId`, but `date`). No constraint to
  // surface; the stringified value lives on `stringValue`, left untouched.
  if (error.name === 'CastError') {
    switch (error.kind?.toLowerCase()) {
      case 'number':
      case 'decimal128':
        return 'Must be a number';
      case 'date':
        return 'Must be a valid date';
      case 'objectid':
        return 'Must be a valid id';
      case 'boolean':
        return 'Must be a boolean';
      case 'string':
        return 'Must be a string';
      case 'buffer':
        return 'Must be a valid binary value';
      default:
        return 'Invalid value';
    }
  }

  const props = error.properties as ValidatorConstraintProperties;
  switch (error.kind) {
    case 'required':
      return 'Required';
    case 'enum': {
      // enum values are API-contract constants (the allowed set), safe to name.
      const values = props.enumValues;
      return values && values.length > 0
        ? `Must be one of: ${values.map(String).join(', ')}`
        : 'Invalid value';
    }
    case 'min': {
      const bound = renderBound(props.min);
      return bound === undefined
        ? 'Value is too small'
        : `Must be at least ${bound}`;
    }
    case 'max': {
      const bound = renderBound(props.max);
      return bound === undefined
        ? 'Value is too large'
        : `Must be at most ${bound}`;
    }
    case 'minlength':
      return typeof props.minlength === 'number'
        ? `Must be at least ${props.minlength} characters`
        : 'Too short';
    case 'maxlength':
      return typeof props.maxlength === 'number'
        ? `Must be at most ${props.maxlength} characters`
        : 'Too long';
    case 'regexp':
      return 'Invalid format';
    default:
      // `user` (custom validator fns, whose message we can't trust) and any
      // kind we don't model land on the generic fallback.
      return 'Invalid value';
  }
}

/**
 * Sanitize an error for the RESOLVED-branch log line. A raw Mongoose
 * `ValidationError`'s `.message` (and `.stack` header) interpolates the
 * rejected `{VALUE}`, so `logger.warn(err)` would leak the submission into
 * logs — and whatever ships them (Sentry, retention) — even after the 400
 * body was sanitized. Rebuild a fresh `Error` that reuses the per-path
 * `safeValidationMessage` texts under the safe static prefix
 * (`<ModelName> validation failed`); its stack is minted here, input-free.
 * Anything else passes through untouched. The UNRESOLVED 500 path deliberately
 * keeps logging the original error in full: that branch is a server-side
 * defect, and the developer needs every detail.
 */
export function toLoggableError(err: unknown): unknown {
  if (!(err instanceof mongoose.Error.ValidationError)) {
    return err;
  }
  const parts = Object.entries(err.errors).map(
    ([path, fieldError]) => `${path}: ${safeValidationMessage(fieldError)}`,
  );
  // Mongoose keeps the static, value-free prefix (`<ModelName> validation
  // failed`) on `_message` — a runtime field its published types omit.
  const rawPrefix = (err as { _message?: unknown })._message;
  const prefix =
    typeof rawPrefix === 'string' ? rawPrefix : 'Validation failed';
  const sanitized = new Error(
    `${prefix} (safety net, sanitized): ${parts.join(', ')}`,
  );
  sanitized.name = 'ValidationError';
  return sanitized;
}

/**
 * Safety net for an escaped Mongoose `ValidationError`: returns a per-field
 * `{ <path>: message }` map ONLY when every failing model path is a field the
 * client actually sent — the keys of the validated `request` ∪ `query`, minus
 * the framework-injected `contentType` discriminant (see
 * `ControllerManager.#wrapHandlerEntry`). A nested path (`profile.name`)
 * matches on its first segment and is reported under the full path (the
 * client owns that subtree). Any renamed/internal path → `null`, so the
 * caller keeps the honest 500 and never leaks a non-public field name.
 *
 * Each message is rebuilt by `safeValidationMessage` from the validation
 * `kind` + constraint — the raw `err.errors[path].message` is NEVER used, so
 * the submitted value can't ride into the response or the log.
 */
export function matchedClientValidationErrors(
  err: mongoose.Error.ValidationError,
  req: FrameworkRequest,
): Record<string, string> | null {
  const failingPaths = Object.keys(err.errors);
  if (failingPaths.length === 0) {
    return null;
  }
  const inputKeys = new Set<string>();
  for (const source of [req.appInfo.request, req.appInfo.query]) {
    if (source) {
      for (const key of Object.keys(source)) {
        inputKeys.add(key);
      }
    }
  }
  inputKeys.delete('contentType');

  const errors: Record<string, string> = {};
  for (const failingPath of failingPaths) {
    if (!inputKeys.has(failingPath.split('.')[0])) {
      return null;
    }
    errors[failingPath] = safeValidationMessage(err.errors[failingPath]);
  }
  return errors;
}

/**
 * Framework built-in registry entries, checked AFTER any consumer-registered
 * handlers ("yours win"):
 *   1. `HttpError` → its own status / `body ?? { message }`; `verbose`
 *      (deliberate control flow, not a defect).
 *   2. Escaped Mongoose `ValidationError` → the safety net above; `warn`
 *      (signals a route schema missing a constraint the model enforces).
 */
export function builtInErrorHandlers(): RegisteredErrorHandler[] {
  return [
    {
      errorClass: HttpError,
      // Entries are stored type-erased (`ErrorHandlerFn`); `resolveError`
      // guarantees `instanceof errorClass` before the call.
      handler: (err) => {
        const httpErr = err as HttpError;
        return {
          status: httpErr.status,
          body: httpErr.body ?? { message: httpErr.message },
        };
      },
      logLevel: 'verbose',
    },
    {
      errorClass: mongoose.Error.ValidationError,
      handler: (err, req) => {
        const clientErrors = matchedClientValidationErrors(
          err as mongoose.Error.ValidationError,
          req,
        );
        return clientErrors
          ? { status: 400, body: { errors: clientErrors } }
          : null;
      },
      logLevel: 'warn',
    },
  ];
}
