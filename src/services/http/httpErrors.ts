/**
 * Throwable HTTP errors — the deliberate way to produce a status from deep
 * business logic without threading `res`. Thrown under a route handler, they
 * resolve through the error-handler registry
 * (`HttpServer.registerErrorHandler`) via a built-in mapper:
 * `status` + `body ?? { message }`, logged at `verbose` (control flow, not a
 * defect). Subclass for other statuses, or construct the base directly:
 * `new HttpError(422, 'Unprocessable')`.
 */
export class HttpError extends Error {
  readonly status: number;

  /** Optional response-body override; the mapper falls back to `{ message }`. */
  readonly body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.body = body;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request', body?: unknown) {
    super(400, message, body);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized', body?: unknown) {
    super(401, message, body);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden', body?: unknown) {
    super(403, message, body);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found', body?: unknown) {
    super(404, message, body);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict', body?: unknown) {
    super(409, message, body);
  }
}
