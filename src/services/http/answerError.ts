import type winston from 'winston';
import type { IApp } from '../../server.ts';
import { ValidationError } from '../validate/ValidationError.ts';
import {
  serverErrorResponse,
  toLoggableError,
  validationFailedMessage,
} from './builtinErrorHandlers.ts';
import type { FrameworkRequest } from './HttpServer.ts';
import { FRAMEWORK_ERROR_CODES } from './httpErrors.ts';
import { HttpResponse } from './responses.ts';

/**
 * Errors thrown while validating a route's params, body or query (as opposed
 * to errors the handler threw). Only those get the validation 400 fallback.
 */
const validationStageErrors = new WeakSet<object>();

/** @internal Mark an error as thrown by request validation. */
export function markValidationStage(error: unknown): void {
  if (typeof error === 'object' && error !== null) {
    validationStageErrors.add(error);
  }
}

/** @internal Was `error` thrown by request validation? */
export function isValidationStageError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    validationStageErrors.has(error)
  );
}

/**
 * The response for a framework `ValidationError` thrown by request
 * validation, when no registered handler answers it: the client 400 with the
 * per-field payload. `undefined` for anything else.
 */
export function validationFallback(
  error: unknown,
  req: FrameworkRequest,
): HttpResponse | undefined {
  if (
    !isValidationStageError(error) ||
    !ValidationError.isValidationError(error)
  ) {
    return undefined;
  }
  return HttpResponse.json(400, {
    error: FRAMEWORK_ERROR_CODES.validationFailed,
    message: validationFailedMessage(req),
    errors: error.message,
  });
}

/**
 * The response for an error thrown while validating or handling a request.
 * Error-handler registry first: consumer-registered handlers, then the
 * built-ins (`HttpError` mapper, mongoose safety nets) — the first `instanceof`
 * match returning non-null wins, logged at the entry's own level. A handled
 * error's log line rides into log shippers, so it is rebuilt value-free by
 * `toLoggableError` first. Anything unresolved is a server-side defect: logged
 * in full, answered with a generic 500 — unless the caller passes the
 * `unresolved` response (the validation 400), a client error that is not
 * logged.
 */
export async function answerError(
  app: IApp,
  logger: winston.Logger | undefined,
  err: unknown,
  req: FrameworkRequest,
  unresolved?: HttpResponse,
): Promise<HttpResponse> {
  const resolved = app.httpServer
    ? await app.httpServer.resolveError(err, req)
    : null;
  if (resolved) {
    logger?.[resolved.logLevel](toLoggableError(err));
    return resolved.response;
  }
  if (unresolved) {
    return unresolved;
  }
  logger?.error(err);
  return serverErrorResponse(req);
}
