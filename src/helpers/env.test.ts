import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { envBool } from './env.ts';

describe('envBool (doc 14)', () => {
  const KEY = 'TEST_ENV_BOOL_XYZ';
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = original;
    }
  });

  it('returns the default when unset', () => {
    delete process.env[KEY];
    assert.strictEqual(envBool(KEY, true), true);
    assert.strictEqual(envBool(KEY, false), false);
  });

  it('returns the default for an empty string', () => {
    process.env[KEY] = '';
    assert.strictEqual(envBool(KEY, true), true);
    assert.strictEqual(envBool(KEY, false), false);
  });

  it('treats "true" and "1" as true', () => {
    process.env[KEY] = 'true';
    assert.strictEqual(envBool(KEY, false), true);
    process.env[KEY] = '1';
    assert.strictEqual(envBool(KEY, false), true);
  });

  it('treats "false"/"0"/"no"/"off" — and any other value — as false', () => {
    for (const v of ['false', '0', 'no', 'off', 'TRUE', 'yes', 'anything']) {
      process.env[KEY] = v;
      assert.strictEqual(envBool(KEY, true), false);
    }
  });
});

// Config modules are evaluated once at import, so a changed env only takes
// effect after a module-registry reset + a fresh dynamic import.
describe('config/log enable coercion (doc 14)', () => {
  const keys = ['LOGGER_SENTRY_ENABLE', 'LOGGER_CONSOLE_ENABLE'] as const;
  const original: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (original[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = original[k];
      }
    }
  });

  let importSequence = 0;
  const loadLog = async () => {
    importSequence += 1;
    return (await import(`../config/log.ts?test=${importSequence}`)).default;
  };

  it('LOGGER_SENTRY_ENABLE="false" disables sentry (not a truthy string)', async () => {
    original.LOGGER_SENTRY_ENABLE = process.env.LOGGER_SENTRY_ENABLE;
    process.env.LOGGER_SENTRY_ENABLE = 'false';
    const log = await loadLog();
    assert.strictEqual(
      log.transports.find((t) => t.transport === 'sentry')?.enable,
      false,
    );
  });

  it('LOGGER_CONSOLE_ENABLE="false" can actually disable the console', async () => {
    original.LOGGER_CONSOLE_ENABLE = process.env.LOGGER_CONSOLE_ENABLE;
    process.env.LOGGER_CONSOLE_ENABLE = 'false';
    const log = await loadLog();
    assert.strictEqual(
      log.transports.find((t) => t.transport === 'console')?.enable,
      false,
    );
  });
});
