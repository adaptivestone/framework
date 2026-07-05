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

/**
 * Safety net for an escaped Mongoose `ValidationError`: returns a per-field
 * `{ <path>: message }` map ONLY when every failing model path is a field the
 * client actually sent — the keys of the validated `request` ∪ `query`, minus
 * the framework-injected `contentType` discriminant (see
 * `ControllerManager.#wrapHandlerEntry`). A nested path (`profile.name`)
 * matches on its first segment and is reported under the full path (the
 * client owns that subtree). Any renamed/internal path → `null`, so the
 * caller keeps the honest 500 and never leaks a non-public field name.
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
    errors[failingPath] = err.errors[failingPath].message;
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
