import { makeOncePerClassWarner } from '../../helpers/deprecation.ts';
import type { ValidationIssue } from '../validate/types.ts';
import {
  ValidationError,
  type ValidationErrorPayload,
} from '../validate/ValidationError.ts';

/** Details form: answered as `{ error?: code, message, errors? }`; `i18nKey` stays on the server. */
export interface HttpErrorDetails {
  /** English text: the log line, and the response message unless `i18nKey` translates it. */
  message: string;
  /** Machine-readable code, answered as `{ error: code, message }`. */
  code?: string;
  /** Translation key for the response message; stays on the server. */
  i18nKey?: string;
  /**
   * Field errors, the same shape as request validation: `{ field: msg | [msg] }`
   * or validation issues (with `params` for interpolation). Answered as
   * `errors: { field: [msg] }`; i18n-key messages are translated.
   */
  errors?: ValidationErrorPayload | ReadonlyArray<ValidationIssue>;
}

const warnBodyArgument = makeOncePerClassWarner(
  'ASF_DEP_HTTP_ERROR_BODY',
  (name) =>
    `${name} received the positional body argument, which is deprecated. Put field errors in the details object ({ message, errors }), or register an error handler for a custom body. The argument will be removed in v6.`,
);

/**
 * Throwable HTTP errors — the deliberate way to produce a status from deep
 * business logic without threading `res`. Thrown under a route handler, they
 * resolve through the error-handler registry
 * (`HttpServer.registerErrorHandler`) via a built-in mapper:
 * `status` + `{ error?: code, message, errors? }` (message translated via
 * `i18nKey`, field errors like request validation), logged at `verbose`
 * (control flow, not a defect).
 * Subclass for other statuses, or construct the base directly:
 * `new HttpError(422, 'Unprocessable')`.
 */
export class HttpError extends Error {
  readonly status: number;

  /** @deprecated Positional body override (wins over everything); removed in v6. */
  readonly body?: unknown;

  readonly code?: string;

  readonly i18nKey?: string;

  /** Field errors from `details.errors`, normalized to validation issues. */
  readonly issues?: ReadonlyArray<ValidationIssue>;

  constructor(status: number, message: string | HttpErrorDetails);
  /** @deprecated Use `{ message, errors }` for field errors, or a registered error handler for a custom body. Removed in v6. */
  constructor(
    status: number,
    message: string | HttpErrorDetails,
    body: unknown,
  );
  constructor(
    status: number,
    message: string | HttpErrorDetails,
    body?: unknown,
  ) {
    const details: HttpErrorDetails =
      typeof message === 'string' ? { message } : message;
    super(details.message);
    if (body !== undefined) {
      warnBodyArgument(new.target);
    }
    this.name = new.target.name;
    this.status = status;
    this.body = body;
    this.code = details.code;
    this.i18nKey = details.i18nKey;
    if (details.errors) {
      const { issues } = new ValidationError(details.errors);
      if (issues.length) {
        this.issues = issues;
      }
    }
  }
}

export class BadRequestError extends HttpError {
  constructor(message?: string | HttpErrorDetails);
  /** @deprecated Use `{ message, errors }` for field errors, or a registered error handler for a custom body. Removed in v6. */
  constructor(message: string | HttpErrorDetails | undefined, body: unknown);
  constructor(
    message: string | HttpErrorDetails = 'Bad request',
    body?: unknown,
  ) {
    super(400, message, body);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message?: string | HttpErrorDetails);
  /** @deprecated Use `{ message, errors }` for field errors, or a registered error handler for a custom body. Removed in v6. */
  constructor(message: string | HttpErrorDetails | undefined, body: unknown);
  constructor(
    message: string | HttpErrorDetails = 'Unauthorized',
    body?: unknown,
  ) {
    super(401, message, body);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message?: string | HttpErrorDetails);
  /** @deprecated Use `{ message, errors }` for field errors, or a registered error handler for a custom body. Removed in v6. */
  constructor(message: string | HttpErrorDetails | undefined, body: unknown);
  constructor(
    message: string | HttpErrorDetails = 'Forbidden',
    body?: unknown,
  ) {
    super(403, message, body);
  }
}

export class NotFoundError extends HttpError {
  constructor(message?: string | HttpErrorDetails);
  /** @deprecated Use `{ message, errors }` for field errors, or a registered error handler for a custom body. Removed in v6. */
  constructor(message: string | HttpErrorDetails | undefined, body: unknown);
  constructor(
    message: string | HttpErrorDetails = 'Not found',
    body?: unknown,
  ) {
    super(404, message, body);
  }
}

export class ConflictError extends HttpError {
  constructor(message?: string | HttpErrorDetails);
  /** @deprecated Use `{ message, errors }` for field errors, or a registered error handler for a custom body. Removed in v6. */
  constructor(message: string | HttpErrorDetails | undefined, body: unknown);
  constructor(message: string | HttpErrorDetails = 'Conflict', body?: unknown) {
    super(409, message, body);
  }
}
