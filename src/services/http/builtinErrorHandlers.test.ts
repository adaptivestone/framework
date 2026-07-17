import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  builtInErrorHandlers,
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
  it.each([
    ['number', 'Must be a number'],
    ['decimal128', 'Must be a number'],
    ['date', 'Must be a valid date'],
    ['objectId', 'Must be a valid id'],
    ['boolean', 'Must be a boolean'],
    ['string', 'Must be a string'],
    ['buffer', 'Must be a valid binary value'],
    ['unmapped-type', 'Invalid value'],
  ])('maps a %s cast without echoing its value', (kind, expected) => {
    const error = validationError(
      new mongoose.Error.CastError(kind, 'SECRET_INPUT', 'field'),
    );

    const result = matchedClientValidationErrors(error, request());

    expect(result).toEqual({ field: expected });
    expect(JSON.stringify(result)).not.toContain('SECRET_INPUT');
  });

  it.each([
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
  ])('maps the %s validator safely', (kind, constraints, expected) => {
    const error = validationError(validatorError(kind, constraints));

    const result = matchedClientValidationErrors(error, request());

    expect(result).toEqual({ field: expected });
    expect(JSON.stringify(result)).not.toContain('SECRET_INPUT');
  });

  it('matches nested paths by their client-owned top-level field', () => {
    const error = validationError(
      validatorError('required', {}, 'profile.name'),
      'profile.name',
    );

    expect(
      matchedClientValidationErrors(error, request({ profile: {} })),
    ).toEqual({ 'profile.name': 'Required' });
  });

  it('rejects empty errors and the injected contentType discriminant', () => {
    expect(
      matchedClientValidationErrors(
        new mongoose.Error.ValidationError(),
        request(),
      ),
    ).toBeNull();

    const contentTypeError = validationError(
      validatorError('required', {}, 'contentType'),
      'contentType',
    );
    expect(
      matchedClientValidationErrors(
        contentTypeError,
        request({ contentType: 'application/json' }),
      ),
    ).toBeNull();
  });
});

describe('toLoggableError', () => {
  it('passes non-Mongoose errors through unchanged', () => {
    const error = new Error('ordinary error');
    expect(toLoggableError(error)).toBe(error);
  });

  it('uses a safe fallback prefix when Mongoose has no string prefix', () => {
    const error = validationError(validatorError('required'));
    (error as { _message?: unknown })._message = 42;

    const result = toLoggableError(error);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).name).toBe('ValidationError');
    expect((result as Error).message).toBe(
      'Validation failed (safety net, sanitized): field: Required',
    );
  });
});

describe('builtInErrorHandlers', () => {
  it('maps an HttpError through the standalone built-in registry', async () => {
    const httpHandler = builtInErrorHandlers()[0];

    expect(
      await httpHandler?.handler(new HttpError(418, 'Teapot'), request()),
    ).toEqual({ status: 418, body: { message: 'Teapot' } });
  });

  it('returns null from the Mongoose handler when client fields do not match', async () => {
    const mongooseHandler = builtInErrorHandlers()[1];
    const error = validationError(validatorError('required'));

    expect(await mongooseHandler?.handler(error, request({}))).toBeNull();
  });
});
