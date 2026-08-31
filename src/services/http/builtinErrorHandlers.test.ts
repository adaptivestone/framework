import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import mongoose from 'mongoose';
import { testEach } from '../../tests/parameterized.ts';
import {
  builtInErrorHandlers,
  matchedClientCastError,
  matchedClientValidationErrors,
  toLoggableError,
} from './builtinErrorHandlers.ts';
import type { FrameworkRequest } from './HttpServer.ts';
import { HttpError } from './httpErrors.ts';

const request = (
  body: Record<string, unknown> = { field: 'client-value' },
  query: Record<string, unknown> = {},
) => ({ appInfo: { request: body, query } }) as unknown as FrameworkRequest;

const validationError = (
  fieldError: mongoose.Error.ValidatorError | mongoose.Error.CastError,
  path = 'field',
) => {
  const error = new mongoose.Error.ValidationError();
  error.addError(path, fieldError);
  return error;
};

const validatorError = (
  kind: string,
  constraints: Record<string, unknown> = {},
  path = 'field',
) =>
  new mongoose.Error.ValidatorError({
    message: 'raw message containing SECRET_INPUT',
    type: kind,
    path,
    value: 'SECRET_INPUT',
    ...constraints,
  } as ConstructorParameters<typeof mongoose.Error.ValidatorError>[0]);

describe('Mongoose validation safety-net messages', () => {
  testEach(
    [
      ['number', 'Must be a number'],
      ['decimal128', 'Must be a number'],
      ['date', 'Must be a valid date'],
      ['objectId', 'Must be a valid id'],
      ['boolean', 'Must be a boolean'],
      ['string', 'Must be a string'],
      ['buffer', 'Must be a valid binary value'],
      ['unmapped-type', 'Invalid value'],
    ],
    'maps a %s cast without echoing its value',
    (kind, expected) => {
      const error = validationError(
        new mongoose.Error.CastError(kind, 'SECRET_INPUT', 'field'),
      );

      const result = matchedClientValidationErrors(error, request());

      assert.deepStrictEqual(result, { field: expected });
      assert.ok(!JSON.stringify(result).includes('SECRET_INPUT'));
    },
  );

  testEach<[string, Record<string, unknown>, string]>(
    [
      ['required', {}, 'Required'],
      ['enum', { enumValues: [] }, 'Invalid value'],
      ['min', { min: 3 }, 'Must be at least 3'],
      ['min', { min: 'three' }, 'Value is too small'],
      [
        'max',
        { max: new Date('2030-01-02T03:04:05.000Z') },
        'Must be at most 2030-01-02T03:04:05.000Z',
      ],
      ['max', { max: 'many' }, 'Value is too large'],
      ['minlength', { minlength: 2 }, 'Must be at least 2 characters'],
      ['minlength', { minlength: 'two' }, 'Too short'],
      ['maxlength', { maxlength: 'five' }, 'Too long'],
      ['regexp', {}, 'Invalid format'],
      ['user', {}, 'Invalid value'],
    ],
    'maps the %s validator safely',
    (kind, constraints, expected) => {
      const error = validationError(validatorError(kind, constraints));

      const result = matchedClientValidationErrors(error, request());

      assert.deepStrictEqual(result, { field: expected });
      assert.ok(!JSON.stringify(result).includes('SECRET_INPUT'));
    },
  );

  it('matches nested paths by their client-owned top-level field', () => {
    const error = validationError(
      validatorError('required', {}, 'profile.name'),
      'profile.name',
    );

    assert.deepStrictEqual(
      matchedClientValidationErrors(error, request({ profile: {} })),
      { 'profile.name': 'Required' },
    );
  });

  it('rejects empty errors and the injected contentType discriminant', () => {
    assert.strictEqual(
      matchedClientValidationErrors(
        new mongoose.Error.ValidationError(),
        request(),
      ),
      null,
    );

    const contentTypeError = validationError(
      validatorError('required', {}, 'contentType'),
      'contentType',
    );
    assert.strictEqual(
      matchedClientValidationErrors(
        contentTypeError,
        request({ contentType: 'application/json' }),
      ),
      null,
    );
  });
});

describe('standalone CastError safety net', () => {
  const castError = (value: unknown, path = '_id', kind = 'ObjectId') =>
    new mongoose.Error.CastError(kind, value as string, path);

  const reqWith = (over: {
    params?: Record<string, string>;
    request?: Record<string, unknown>;
    query?: Record<string, unknown>;
  }) =>
    ({
      params: over.params ?? {},
      appInfo: { request: over.request ?? {}, query: over.query ?? {} },
    }) as unknown as FrameworkRequest;

  it('blames the path param that carried the rejected value', () => {
    assert.deepStrictEqual(
      matchedClientCastError(
        castError('abc'),
        reqWith({ params: { id: 'abc' } }),
      ),
      { id: 'Must be a valid id' },
    );
  });

  it('matches a value sourced from the validated body or query too', () => {
    assert.deepStrictEqual(
      matchedClientCastError(
        castError('abc'),
        reqWith({ query: { ref: 'abc' } }),
      ),
      { ref: 'Must be a valid id' },
    );
    assert.deepStrictEqual(
      matchedClientCastError(
        castError('abc'),
        reqWith({ request: { ref: 'abc' } }),
      ),
      { ref: 'Must be a valid id' },
    );
  });

  it('returns null for a server-computed value the client never sent', () => {
    assert.strictEqual(
      matchedClientCastError(
        castError('server-side-constant'),
        reqWith({ params: { id: 'abc' } }),
      ),
      null,
    );
  });

  it('never matches on a non-primitive (every object stringifies alike)', () => {
    assert.strictEqual(
      matchedClientCastError(castError({}), reqWith({ request: { ref: {} } })),
      null,
    );
  });

  it('ignores the framework-injected contentType discriminant', () => {
    assert.strictEqual(
      matchedClientCastError(
        castError('application/json'),
        reqWith({ request: { contentType: 'application/json' } }),
      ),
      null,
    );
  });

  it('reports the cast KIND, never the rejected value', () => {
    const result = matchedClientCastError(
      castError('SECRET_INPUT', '_id', 'Number'),
      reqWith({ params: { id: 'SECRET_INPUT' } }),
    );

    assert.deepStrictEqual(result, { id: 'Must be a number' });
    assert.ok(!JSON.stringify(result).includes('SECRET_INPUT'));
    // The internal model path must not leak either.
    assert.ok(!JSON.stringify(result).includes('_id'));
  });

  it('sanitizes a standalone CastError for the log line', () => {
    const result = toLoggableError(castError('SECRET_INPUT'));

    assert.ok(result instanceof Error);
    assert.strictEqual((result as Error).name, 'CastError');
    assert.ok(!(result as Error).message.includes('SECRET_INPUT'));
    // The model path IS kept — a field name is safe and the developer needs it.
    assert.ok((result as Error).message.includes('_id'));
  });
});

describe('toLoggableError', () => {
  it('passes non-Mongoose errors through unchanged', () => {
    const error = new Error('ordinary error');
    assert.strictEqual(toLoggableError(error), error);
  });

  it('uses a safe fallback prefix when Mongoose has no string prefix', () => {
    const error = validationError(validatorError('required'));
    (error as { _message?: unknown })._message = 42;

    const result = toLoggableError(error);

    assert.ok(result instanceof Error);
    assert.strictEqual((result as Error).name, 'ValidationError');
    assert.strictEqual(
      (result as Error).message,
      'Validation failed (safety net, sanitized): field: Required',
    );
  });
});

describe('builtInErrorHandlers', () => {
  it('maps an HttpError through the standalone built-in registry', async () => {
    const httpHandler = builtInErrorHandlers()[0];

    assert.deepStrictEqual(
      await httpHandler?.handler(new HttpError(418, 'Teapot'), request()),
      { status: 418, body: { message: 'Teapot' } },
    );
  });

  it('returns null from the Mongoose handler when client fields do not match', async () => {
    const mongooseHandler = builtInErrorHandlers()[1];
    const error = validationError(validatorError('required'));

    assert.strictEqual(
      await mongooseHandler?.handler(error, request({})),
      null,
    );
  });
});
