import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { testEach } from '../../tests/parameterized.ts';
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
    assert.ok(err instanceof Error);
    assert.strictEqual(err.status, 422);
    assert.strictEqual(err.message, 'Unprocessable');
    assert.deepStrictEqual(err.body, { errors: { csv: 'bad' } });
    assert.strictEqual(err.name, 'HttpError');
  });

  testEach(
    [
      [BadRequestError, 400, 'Bad request'],
      [UnauthorizedError, 401, 'Unauthorized'],
      [ForbiddenError, 403, 'Forbidden'],
      [NotFoundError, 404, 'Not found'],
      [ConflictError, 409, 'Conflict'],
    ] as const,
    'subclass fixes status %#',
    (Cls, status, defaultMessage) => {
      const err = new Cls();
      assert.ok(err instanceof HttpError);
      assert.strictEqual(err.status, status);
      assert.strictEqual(err.message, defaultMessage);
      assert.strictEqual(err.body, undefined);
      assert.strictEqual(err.name, Cls.name);
    },
  );

  it('subclasses accept a custom message and body', () => {
    const err = new NotFoundError('Boat not found', { code: 'BOAT_MISSING' });
    assert.strictEqual(err.status, 404);
    assert.strictEqual(err.message, 'Boat not found');
    assert.deepStrictEqual(err.body, { code: 'BOAT_MISSING' });
  });

  it('accepts a details object with a code and an i18n key', () => {
    const err = new HttpError(422, {
      code: 'UNSUPPORTED_COUNTRY',
      i18nKey: 'errors.unsupportedCountry',
      message: 'The selected country is not supported.',
    });
    assert.strictEqual(err.status, 422);
    assert.strictEqual(err.message, 'The selected country is not supported.');
    assert.strictEqual(err.code, 'UNSUPPORTED_COUNTRY');
    assert.strictEqual(err.i18nKey, 'errors.unsupportedCountry');
    assert.strictEqual(err.body, undefined);
  });

  testEach(
    [
      [BadRequestError, 400],
      [UnauthorizedError, 401],
      [ForbiddenError, 403],
      [NotFoundError, 404],
      [ConflictError, 409],
    ] as const,
    'subclass accepts a details object %#',
    (Cls, status) => {
      const err = new Cls({ code: 'X', message: 'English' });
      assert.ok(err instanceof HttpError);
      assert.strictEqual(err.status, status);
      assert.strictEqual(err.message, 'English');
      assert.strictEqual(err.code, 'X');
      assert.strictEqual(err.i18nKey, undefined);
      assert.strictEqual(err.name, Cls.name);
    },
  );

  it('a consumer subclass keeps the instanceof chain and its own name', () => {
    class PaymentRequiredError extends HttpError {
      constructor(message = 'Subscription expired') {
        super(402, message);
      }
    }
    const err = new PaymentRequiredError();
    assert.ok(err instanceof HttpError);
    assert.strictEqual(err.status, 402);
    assert.strictEqual(err.name, 'PaymentRequiredError');
  });
});
