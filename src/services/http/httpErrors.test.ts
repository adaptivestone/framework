import { describe, expect, it } from 'vitest';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  UnauthorizedError,
} from './httpErrors.ts';

describe('httpErrors', () => {
  it('base HttpError carries status, message and optional body', () => {
    const err = new HttpError(422, 'Unprocessable', { errors: { csv: 'bad' } });
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(422);
    expect(err.message).toBe('Unprocessable');
    expect(err.body).toEqual({ errors: { csv: 'bad' } });
    expect(err.name).toBe('HttpError');
  });

  it.each([
    [BadRequestError, 400, 'Bad request'],
    [UnauthorizedError, 401, 'Unauthorized'],
    [ForbiddenError, 403, 'Forbidden'],
    [NotFoundError, 404, 'Not found'],
    [ConflictError, 409, 'Conflict'],
  ] as const)('subclass fixes status %#', (Cls, status, defaultMessage) => {
    const err = new Cls();
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(status);
    expect(err.message).toBe(defaultMessage);
    expect(err.body).toBeUndefined();
    expect(err.name).toBe(Cls.name);
  });

  it('subclasses accept a custom message and body', () => {
    const err = new NotFoundError('Boat not found', { code: 'BOAT_MISSING' });
    expect(err.status).toBe(404);
    expect(err.message).toBe('Boat not found');
    expect(err.body).toEqual({ code: 'BOAT_MISSING' });
  });

  it('a consumer subclass keeps the instanceof chain and its own name', () => {
    class PaymentRequiredError extends HttpError {
      constructor(message = 'Subscription expired') {
        super(402, message);
      }
    }
    const err = new PaymentRequiredError();
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(402);
    expect(err.name).toBe('PaymentRequiredError');
  });
});
