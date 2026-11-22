import type { Response } from 'express';
import mongoose from 'mongoose';
import { translateWithDefault } from '../../helpers/translate.ts';
import {
  issuesToPayload,
  translateIssues,
  ValidationError,
} from '../validate/ValidationError.ts';
import type { FrameworkRequest } from './HttpServer.ts';
import { FRAMEWORK_ERROR_CODES, HttpError } from './httpErrors.ts';
import { HttpResponse, NO_BODY_STATUSES } from './responses.ts';

/** The `message` of every framework 500 response. */
export const serverErrorMessage = (req: FrameworkRequest) =>
  translateWithDefault(
    req,
    'http.serverError',
    'Something went wrong. Please try again later.',
  );

/** The `message` of every framework field-error (400) response. */
export const validationFailedMessage = (req: FrameworkRequest) =>
  translateWithDefault(req, 'http.validationFailed', 'Validation failed');

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
  /** Response headers, e.g. `{ 'Retry-After': '30' }` on a 429. */
  headers?: Record<string, string>;
}

/** A resolved error: the response to send, the entry's log level, and the legacy result fields. */
export interface ResolvedError extends ErrorHandlerResult {
  response: HttpResponse;
  logLevel: ErrorLogLevel;
}

/**
 * Answer a resolved error: its headers, status and JSON body.
 * @deprecated The framework sends `ResolvedError.response` through the response writer now; build one with `errorResultResponse`.
 */
export function sendErrorResult(
  res: Response,
  { status, body, headers }: ErrorHandlerResult,
) {
  for (const [name, value] of Object.entries(headers ?? {})) {
    res.setHeader(name, value);
  }
  return res.status(status).json(body);
}

/**
 * A `{ status, body, headers }` result as the response `sendErrorResult` sent:
 * JSON, with a `Content-Type` header kept as the media type, and no body for
 * an undefined body or a status that never carries one.
 */
export function errorResultResponse({
  status,
  body,
  headers,
}: ErrorHandlerResult): HttpResponse {
  // By lower-case name: a later header replaces an earlier one, as `setHeader`
  // did, but cookies add up. Typed as a string, but a JavaScript app may pass
  // an array: each cookie stays its own field, other values are joined.
  const fields = new Map<string, [string, string][]>();
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = name.toLowerCase();
    if (key === 'set-cookie') {
      const cookies: unknown[] = Array.isArray(value) ? value : [value];
      fields.set(key, [
        ...(fields.get(key) ?? []),
        ...cookies.map((cookie): [string, string] => [name, String(cookie)]),
      ]);
    } else {
      fields.set(key, [
        [name, Array.isArray(value) ? value.join(', ') : value],
      ]);
    }
  }
  if (body === undefined || NO_BODY_STATUSES.has(status)) {
    // `empty` owns no media type, so the header rides along unchanged.
    return HttpResponse.empty(status, { headers: [...fields.values()].flat() });
  }
  const contentType = fields.get('content-type')?.[0]?.[1];
  fields.delete('content-type');
  return HttpResponse.json(status, body, {
    headers: [...fields.values()].flat(),
    contentType,
  });
}

/**
 * @internal The response to send for a resolved error. A replaced
 * `resolveError` may return only the legacy fields; it is built from those.
 */
export function resolvedErrorResponse(
  resolved: ErrorHandlerResult & { response?: HttpResponse },
): HttpResponse {
  return resolved.response ?? errorResultResponse(resolved);
}

/** Requests a registry handler failed for (threw, or returned an invalid result). */
const failedHandlerRequests = new WeakSet<object>();

/** @internal Record that a registry handler failed for `req`, until `errorHandlerFailed` reads it. */
export function markErrorHandlerFailed(req: object): void {
  failedHandlerRequests.add(req);
}

/**
 * @internal Did a registry handler fail for `req`? Its error answers the
 * generic 500, never a caller's fallback response. Kept per request, so
 * requests that throw the same error instance do not interfere. The read
 * clears the mark.
 */
export function errorHandlerFailed(req: object): boolean {
  return failedHandlerRequests.delete(req);
}

/** The generic 500 answered for an error nothing in the registry resolved. */
export const serverErrorResponse = (req: FrameworkRequest) =>
  HttpResponse.json(500, {
    error: FRAMEWORK_ERROR_CODES.serverError,
    message: serverErrorMessage(req),
  });

/**
 * What `registerErrorHandler` accepts: any `Error` subclass, including one that
 * widens `message` (the framework's `ValidationError` carries its field
 * payload there). Structural, so the core declarations need not import it.
 */
export type RegistrableError = Omit<Error, 'message'>;

/**
 * Maps an error to a response: a `{ status, body, headers? }` result, an
 * `HttpResponse` (for other content or full control), or `null`/`undefined`
 * to pass to the next entry.
 */
export type ErrorHandlerFn<E extends RegistrableError = Error> = (
  err: E,
  req: FrameworkRequest,
) =>
  | ErrorHandlerResult
  | HttpResponse
  | null
  | undefined
  | Promise<ErrorHandlerResult | HttpResponse | null | undefined>;

/** A registered (class, handler, level) triple as stored by the registry. */
export interface RegisteredErrorHandler {
  errorClass: abstract new (...args: never[]) => RegistrableError;
  handler: ErrorHandlerFn<RegistrableError>;
  logLevel: ErrorLogLevel;
  /** @internal Picks the level per error; wins over `logLevel`. */
  logLevelFor?: (err: RegistrableError) => ErrorLogLevel;
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
 * A request `ValidationError` (its `message` is the field payload) becomes
 * `Request validation failed (<n> fields)`: a path can be a client-supplied
 * key, so neither paths, values nor per-field texts are logged.
 * Anything else passes through untouched. The UNRESOLVED 500 path deliberately
 * keeps logging the original error in full (a request `ValidationError` aside):
 * that branch is a server-side defect, and the developer needs every detail.
 */
export function toLoggableError(err: unknown): unknown {
  // A standalone `CastError` ("Cast to ObjectId failed for value \"<input>\"")
  // embeds the rejected value in its message exactly like a ValidationError, and
  // a path param can carry PII (an email, a token) just as a body field can.
  // Rebuild it value-free, keeping the model path — the resolved branch logs at
  // `warn` into Sentry/retention, and the developer still needs to know WHICH
  // path failed to cast, which is safe (a field name, never input).
  if (err instanceof mongoose.Error.CastError) {
    const sanitized = new Error(
      `Cast failed at path "${err.path}" (safety net, sanitized): ${safeValidationMessage(err)}`,
    );
    sanitized.name = 'CastError';
    return sanitized;
  }
  if (ValidationError.isValidationError(err)) {
    // Its `message` is the field payload; only the field count is logged.
    const count = Object.keys(err.message).length;
    const sanitized = new Error(
      `Request validation failed (${count} field${count === 1 ? '' : 's'})`,
    );
    sanitized.name = err.name;
    return sanitized;
  }
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

/** Is this a primitive we can compare by value? Objects/null are never matched
 * (`String({})` collapses every object to the same text). Path params, query
 * values and JSON scalars are all primitives, so nothing real is lost. */
function isComparablePrimitive(value: unknown): boolean {
  return value !== null && value !== undefined && typeof value !== 'object';
}

/**
 * Client-supplied inputs keyed by the name the CLIENT knows them under: path
 * params (public — they appear in the route's own URL pattern), plus the
 * validated body and query keys. The framework-injected `contentType`
 * discriminant is excluded, as in {@link matchedClientValidationErrors}.
 */
function clientInputEntries(req: FrameworkRequest): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const source of [req.params, req.appInfo?.request, req.appInfo?.query]) {
    if (!source) {
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      if (key !== 'contentType') {
        out.push([key, value]);
      }
    }
  }
  return out;
}

/**
 * Safety net for a STANDALONE Mongoose `CastError` — the shape a path param
 * produces (`findById(req.params.id)` with a malformed id). A `CastError` is a
 * sibling of `ValidationError`, not a subclass, so
 * {@link matchedClientValidationErrors} structurally cannot see it, and its
 * failing path is an internal model field (`_id`) that must never be echoed.
 *
 * Returns `{ <clientKey>: message }` only when the rejected value is one the
 * client actually supplied — matched by VALUE against the path params and the
 * validated body/query, then reported under that public input name. A cast
 * failure on a server-computed value matches nothing and returns `null`, so a
 * genuine server-side defect keeps its honest 500 instead of being blamed on
 * the caller. The message comes from {@link safeValidationMessage}, so the
 * rejected value never rides into the response.
 */
export function matchedClientCastError(
  err: mongoose.Error.CastError,
  req: FrameworkRequest,
): Record<string, string> | null {
  if (!isComparablePrimitive(err.value)) {
    return null;
  }
  const rejected = String(err.value);
  for (const [key, candidate] of clientInputEntries(req)) {
    if (isComparablePrimitive(candidate) && String(candidate) === rejected) {
      return { [key]: safeValidationMessage(err) };
    }
  }
  return null;
}

/**
 * Framework built-in registry entries, checked AFTER any consumer-registered
 * handlers ("yours win"):
 *   1. `HttpError` → its own status, headers and
 *      `body ?? { error?: code, message }`, message translated via `i18nKey`;
 *      `verbose` (deliberate control flow, not a defect), `error` for a 5xx
 *      (a server failure).
 *   2. Escaped Mongoose `ValidationError` → the safety net above; `warn`
 *      (signals a route schema missing a constraint the model enforces).
 *   3. Standalone Mongoose `CastError` → {@link matchedClientCastError}; `warn`
 *      (signals a path param or input reaching the model unvalidated). Declaring
 *      a route `params:` schema turns the same failure into a 400 earlier, with
 *      a message you control.
 */
export function builtInErrorHandlers(): RegisteredErrorHandler[] {
  return [
    {
      errorClass: HttpError,
      // Entries are stored type-erased (`ErrorHandlerFn`); `resolveError`
      // guarantees `instanceof errorClass` before the call.
      handler: (err, req) => {
        const httpErr = err as HttpError;
        const { status } = httpErr;
        const headers = httpErr.headers && { headers: httpErr.headers };
        if (httpErr.body != null) {
          // Custom `{ message, body }` or the deprecated positional body:
          // answered verbatim.
          return { status, body: httpErr.body, ...headers };
        }
        let { message } = httpErr;
        if (httpErr.i18nKey) {
          // `skipInterpolation`: a missing key falls back to the English text
          // literally — it may embed request data, so i18next must not expand
          // `$t(...)` or `{{…}}` inside it.
          const translated = req.appInfo?.i18n?.t(httpErr.i18nKey, {
            defaultValue: message,
            skipInterpolation: true,
          });
          if (typeof translated === 'string') {
            message = translated;
          }
        }
        const body: { error?: string; message: string; errors?: unknown } =
          httpErr.code ? { error: httpErr.code, message } : { message };
        if (httpErr.issues) {
          const t = req.appInfo?.i18n?.t;
          body.errors = issuesToPayload(
            t ? translateIssues(httpErr.issues, t) : httpErr.issues,
          );
        }
        return { status, body, ...headers };
      },
      logLevel: 'verbose',
      logLevelFor: (err) =>
        (err as HttpError).status >= 500 ? 'error' : 'verbose',
    },
    {
      errorClass: mongoose.Error.ValidationError,
      handler: (err, req) => {
        const clientErrors = matchedClientValidationErrors(
          err as mongoose.Error.ValidationError,
          req,
        );
        return clientErrors
          ? {
              status: 400,
              body: {
                error: FRAMEWORK_ERROR_CODES.validationFailed,
                message: validationFailedMessage(req),
                errors: new ValidationError(clientErrors).message,
              },
            }
          : null;
      },
      logLevel: 'warn',
    },
    {
      errorClass: mongoose.Error.CastError,
      handler: (err, req) => {
        const clientErrors = matchedClientCastError(
          err as mongoose.Error.CastError,
          req,
        );
        return clientErrors
          ? {
              status: 400,
              body: {
                error: FRAMEWORK_ERROR_CODES.validationFailed,
                message: validationFailedMessage(req),
                errors: new ValidationError(clientErrors).message,
              },
            }
          : null;
      },
      logLevel: 'warn',
    },
  ];
}
