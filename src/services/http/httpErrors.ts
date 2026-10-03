import { makeOncePerClassWarner } from '../../helpers/deprecation.ts';
import type { ValidationIssue } from '../validate/types.ts';
import {
  ValidationError,
  type ValidationErrorPayload,
} from '../validate/ValidationError.ts';

/** Contract form: answered as `{ error?: code, message, errors? }`; `i18nKey` stays on the server. */
export interface HttpErrorContractDetails {
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
  /** Response headers, e.g. `{ 'Retry-After': '30' }` on a 429. */
  headers?: Record<string, string>;
  body?: never;
}

/** Custom form: `body` IS the response — the contract fields cannot be combined with it. */
export interface HttpErrorBodyDetails {
  /** English text for the log line; not sent. */
  message: string;
  /** The whole response body, sent as-is (no `error`/`message`/`errors` added). */
  body: unknown;
  /** Response headers, e.g. `{ 'Retry-After': '30' }` on a 429. */
  headers?: Record<string, string>;
  code?: never;
  i18nKey?: never;
  errors?: never;
}

export type HttpErrorDetails = HttpErrorContractDetails | HttpErrorBodyDetails;

const CONTRACT_FIELDS = ['code', 'i18nKey', 'errors'] as const;

const warnBodyMixed = makeOncePerClassWarner(
  'ASF_HTTP_ERROR_BODY_MIXED',
  (name, ignored) =>
    `${name} received body together with ${String(ignored)}. body replaces the whole response, so those are ignored. Pass body alone, or drop it to answer { error?, message, errors? }.`,
  'Warning',
);

const warnBodyArgument = makeOncePerClassWarner(
  'ASF_DEP_HTTP_ERROR_BODY',
  (name) =>
    `${name} received the positional body argument, which is deprecated. Use the details object instead: { message, errors } for field errors, or { message, body } for a custom body. The argument will be removed in v6.`,
);

/**
 * Throwable HTTP errors — the deliberate way to produce a status from deep
 * business logic without threading `res`. Thrown from a route handler or a
 * middleware, they resolve through the error-handler registry
 * (`HttpServer.registerErrorHandler`) via a built-in mapper:
 * `status` + `{ error?: code, message, errors? }` (message translated via
 * `i18nKey`, field errors like request validation) or a custom `body`, logged
 * at `verbose` (control flow, not a defect).
 * Subclass for other statuses, or construct the base directly:
 * `new HttpError(422, 'Unprocessable')`.
 */
export class HttpError extends Error {
  readonly status: number;

  /** Custom response body (`{ message, body }`); when set, the contract fields are unused. */
  readonly body?: unknown;

  readonly code?: string;

  readonly i18nKey?: string;

  /** Field errors from `details.errors`, normalized to validation issues. */
  readonly issues?: ReadonlyArray<ValidationIssue>;
  /** Response headers from `details.headers`. */
  readonly headers?: Record<string, string>;

  constructor(status: number, message: string | HttpErrorDetails);
  /** @deprecated Use `{ message, errors }` for field errors, or `{ message, body }` for a custom body. Removed in v6. */
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
    this.headers = details.headers;
    if (details.body !== undefined) {
      // Custom form: the body is the response, so the contract fields are
      // dropped. Types forbid mixing; this guards plain-JS / cast callers.
      const ignored = CONTRACT_FIELDS.filter((k) => details[k] !== undefined);
      if (ignored.length) {
        warnBodyMixed(new.target, ignored.join(', '));
      }
      this.body = details.body;
      return;
    }
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
  /** @deprecated Use `{ message, errors }` for field errors, or `{ message, body }` for a custom body. Removed in v6. */
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
  /** @deprecated Use `{ message, errors }` for field errors, or `{ message, body }` for a custom body. Removed in v6. */
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
  /** @deprecated Use `{ message, errors }` for field errors, or `{ message, body }` for a custom body. Removed in v6. */
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
  /** @deprecated Use `{ message, errors }` for field errors, or `{ message, body }` for a custom body. Removed in v6. */
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
  /** @deprecated Use `{ message, errors }` for field errors, or `{ message, body }` for a custom body. Removed in v6. */
  constructor(message: string | HttpErrorDetails | undefined, body: unknown);
  constructor(message: string | HttpErrorDetails = 'Conflict', body?: unknown) {
    super(409, message, body);
  }
}
