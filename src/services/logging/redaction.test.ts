import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Transport from 'winston-transport';
import { appInstance } from '../../helpers/appInstance.ts';
import { REDACTED, redactValue } from './redaction.ts';

const keys = new Set(['password', 'token', 'authorization']);

describe('redactValue', () => {
  it('replaces sensitive keys at any depth, case-insensitively', () => {
    assert.deepStrictEqual(
      redactValue(
        {
          email: 'a@b.c',
          Token: 'tok',
          user: { password: 'p', name: 'n' },
          list: [{ AUTHORIZATION: 'Bearer x' }, 'plain'],
        },
        keys,
      ),
      {
        email: 'a@b.c',
        Token: REDACTED,
        user: { password: REDACTED, name: 'n' },
        list: [{ AUTHORIZATION: REDACTED }, 'plain'],
      },
    );
  });

  it('never mutates the original value', () => {
    const original = { user: { password: 'p' } };
    redactValue(original, keys);
    assert.deepStrictEqual(original, { user: { password: 'p' } });
  });

  it('leaves non-plain objects and primitives as they are', () => {
    const error = new Error('boom');
    const date = new Date(0);
    assert.strictEqual(redactValue(error, keys), error);
    assert.strictEqual(redactValue(date, keys), date);
    assert.strictEqual(redactValue('token', keys), 'token');
  });

  it('copes with circular structures', () => {
    const value: Record<string, unknown> = { password: 'p' };
    value.self = value;
    const copy = redactValue(value, keys) as Record<string, unknown>;
    assert.strictEqual(copy.password, REDACTED);
    assert.strictEqual(copy.self, copy);
  });
});

describe('framework logger redaction', () => {
  class CaptureTransport extends Transport {
    entries: Record<string, unknown>[] = [];
    log(info: Record<string, unknown>, callback: () => void) {
      this.entries.push(info);
      callback();
    }
  }

  it('redacts the default sensitive keys before any transport', () => {
    const { redact } = appInstance.getConfig('log') as { redact?: string[] };
    assert.deepStrictEqual(redact, [
      'authorization',
      'cookie',
      'password',
      'secret',
      'token',
    ]);

    const capture = new CaptureTransport();
    appInstance.logger.add(capture);
    try {
      const meta = {
        email: 'a@b.c',
        token: 'tok-123',
        user: { Password: 'p' },
      };
      appInstance.logger.info('Login code sent', meta);
      const [entry] = capture.entries;
      assert.strictEqual(entry?.message, 'Login code sent');
      assert.strictEqual(entry?.email, 'a@b.c');
      assert.strictEqual(entry?.token, REDACTED);
      assert.deepStrictEqual(entry?.user, { Password: REDACTED });
      // The caller's object is untouched.
      assert.strictEqual(meta.token, 'tok-123');
      assert.ok(!JSON.stringify(capture.entries).includes('tok-123'));
    } finally {
      appInstance.logger.remove(capture);
    }
  });
});
