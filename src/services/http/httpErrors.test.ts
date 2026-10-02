import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
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
  it('base HttpError carries status, message and optional field errors', () => {
    const err = new HttpError(422, {
      message: 'Unprocessable',
      errors: { csv: 'bad' },
    });
    assert.ok(err instanceof Error);
    assert.strictEqual(err.status, 422);
    assert.strictEqual(err.message, 'Unprocessable');
    assert.deepStrictEqual(err.issues, [{ message: 'bad', path: ['csv'] }]);
    assert.strictEqual(err.body, undefined);
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

  it('subclasses accept field errors; an empty set is dropped', () => {
    const err = new BadRequestError({
      message: 'Bad boat',
      errors: { name: ['too long', 'has digits'] },
    });
    assert.strictEqual(err.status, 400);
    assert.strictEqual(err.issues?.length, 2);
    assert.strictEqual(
      new BadRequestError({ message: 'x', errors: {} }).issues,
      undefined,
    );
  });

  it('still accepts the deprecated positional body and warns once per class', async () => {
    const warnings: { code?: string; message: string }[] = [];
    const onWarning = (w: Error & { code?: string }) =>
      warnings.push({ code: w.code, message: w.message });
    process.on('warning', onWarning);
    try {
      class LegacyError extends NotFoundError {}
      const first = new LegacyError('Boat not found', { code: 'BOAT_MISSING' });
      new LegacyError('again', { code: 'BOAT_MISSING' });
      await setTimeout(0); // warnings are emitted on the next tick

      assert.deepStrictEqual(first.body, { code: 'BOAT_MISSING' });
      const ours = warnings.filter((w) => w.code === 'ASF_DEP_HTTP_ERROR_BODY');
      assert.strictEqual(ours.length, 1);
      assert.match(ours[0]?.message ?? '', /LegacyError/);
    } finally {
      process.off('warning', onWarning);
    }
  });

  it('a custom body is exclusive: no contract fields, no warning', async () => {
    const warnings: string[] = [];
    const onWarning = (w: Error & { code?: string }) =>
      warnings.push(w.code ?? '');
    process.on('warning', onWarning);
    try {
      const err = new ConflictError({
        message: 'Already exists',
        body: { existingId: 'abc' },
      });
      await setTimeout(0);
      assert.deepStrictEqual(err.body, { existingId: 'abc' });
      assert.strictEqual(err.message, 'Already exists');
      assert.strictEqual(err.code, undefined);
      assert.deepStrictEqual(warnings, []);
    } finally {
      process.off('warning', onWarning);
    }
  });

  it('body mixed with contract fields: body wins, warns once per class', async () => {
    const warnings: { code?: string; message: string }[] = [];
    const onWarning = (w: Error & { code?: string }) =>
      warnings.push({ code: w.code, message: w.message });
    process.on('warning', onWarning);
    try {
      class MixedError extends BadRequestError {}
      const mixed = {
        message: 'Bad',
        body: { custom: true },
        code: 'X',
        errors: { a: 'b' },
      };
      // @ts-expect-error body cannot be combined with code/i18nKey/errors
      const err = new MixedError(mixed);
      // @ts-expect-error same rule on the base class
      new MixedError({ message: 'Bad', body: {}, i18nKey: 'k' });
      await setTimeout(0);

      assert.deepStrictEqual(err.body, { custom: true });
      assert.strictEqual(err.code, undefined);
      assert.strictEqual(err.issues, undefined);
      const ours = warnings.filter(
        (w) => w.code === 'ASF_HTTP_ERROR_BODY_MIXED',
      );
      assert.strictEqual(ours.length, 1);
      assert.match(ours[0]?.message ?? '', /MixedError.*code, errors/);
    } finally {
      process.off('warning', onWarning);
    }
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
