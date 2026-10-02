/** Coded form: `code` is sent to the client as `error`; `i18nKey` never is. */
export interface HttpErrorDetails {
  /** English text: the log line, and the response message unless `i18nKey` translates it. */
  message: string;
  /** Machine-readable code, answered as `{ error: code, message }`. */
  code?: string;
  /** Translation key for the response message; stays on the server. */
  i18nKey?: string;
}

/**
 * Throwable HTTP errors — the deliberate way to produce a status from deep
 * business logic without threading `res`. Thrown under a route handler, they
 * resolve through the error-handler registry
 * (`HttpServer.registerErrorHandler`) via a built-in mapper:
 * `status` + `body ?? { error?: code, message }` (message translated via
 * `i18nKey` when present), logged at `verbose` (control flow, not a defect).
 * Subclass for other statuses, or construct the base directly:
 * `new HttpError(422, 'Unprocessable')`.
 */
export class HttpError extends Error {
  readonly status: number;

  /** Optional response-body override; it wins over `message`, `code` and `i18nKey`. */
  readonly body?: unknown;

  readonly code?: string;

  readonly i18nKey?: string;

  constructor(
    status: number,
    message: string | HttpErrorDetails,
    body?: unknown,
  ) {
    const details: HttpErrorDetails =
      typeof message === 'string' ? { message } : message;
    super(details.message);
    this.name = new.target.name;
    this.status = status;
    this.body = body;
    this.code = details.code;
    this.i18nKey = details.i18nKey;
  }
}

export class BadRequestError extends HttpError {
  constructor(
    message: string | HttpErrorDetails = 'Bad request',
    body?: unknown,
  ) {
    super(400, message, body);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(
    message: string | HttpErrorDetails = 'Unauthorized',
    body?: unknown,
  ) {
    super(401, message, body);
  }
}

export class ForbiddenError extends HttpError {
  constructor(
    message: string | HttpErrorDetails = 'Forbidden',
    body?: unknown,
  ) {
    super(403, message, body);
  }
}

export class NotFoundError extends HttpError {
  constructor(
    message: string | HttpErrorDetails = 'Not found',
    body?: unknown,
  ) {
    super(404, message, body);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string | HttpErrorDetails = 'Conflict', body?: unknown) {
    super(409, message, body);
  }
}
