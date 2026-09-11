import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import i18next, { type i18n } from 'i18next';
import { appInstance } from '../../helpers/appInstance.ts';
import type { TI18n } from './I18n.ts';
import type { I18nBaseInstance } from './types.ts';

/**
 * With `i18n.enabled: false` the service hands out a fallback translator
 * instead of an i18next instance. It must honour in-code defaults the same way
 * i18next does, so framework messages stay English rather than leaking keys.
 */
describe('i18n service fallback translator (i18n disabled)', () => {
  let fallback: TI18n;

  before(async () => {
    appInstance.updateConfig('i18n', { enabled: false });
    const i18nService = await appInstance.getI18nService();
    fallback = await i18nService.getI18nForLang('en');
  });

  after(() => {
    appInstance.updateConfig('i18n', { enabled: true });
  });

  it('returns the key when no default is provided', () => {
    assert.strictEqual(
      fallback.t('middleware.auth.notLoggedIn'),
      'middleware.auth.notLoggedIn',
    );
  });

  it('returns options.defaultValue when provided', () => {
    assert.strictEqual(
      fallback.t('middleware.auth.notLoggedIn', {
        defaultValue: 'Please login to application',
      }),
      'Please login to application',
    );
  });

  it('returns the string second argument (i18next default-value overload)', () => {
    assert.strictEqual(
      fallback.t('middleware.role.noAccess', 'You do not have access'),
      'You do not have access',
    );
  });

  it('accepts default-value options and fallback key arrays', () => {
    assert.strictEqual(
      fallback.t(['app.missing', 'app.fallback']),
      'app.fallback',
    );
    assert.strictEqual(
      fallback.t(['app.missing', 'app.fallback'], {
        defaultValue: 'Default',
      }),
      'Default',
    );
    assert.strictEqual(
      fallback.t('app.missing', 'Default', { name: 'Ada' }),
      'Default',
    );
  });
});

it('accepts a real i18next instance through the public structural types', async () => {
  const instance = i18next.createInstance();
  await instance.init({
    lng: 'en',
    resources: {
      en: {
        translation: { greeting: 'Hello {{name}}', nested: { value: 'ok' } },
      },
    },
  });
  const translator: TI18n = instance;
  const base: I18nBaseInstance = instance;
  // Opt-in consumers retain the actual vendor instance and its full API.
  const vendor = base as i18n;
  assert.strictEqual(
    vendor.getResource('en', 'translation', 'greeting'),
    'Hello {{name}}',
  );
  assert.strictEqual(translator.t('greeting', { name: 'Ada' }), 'Hello Ada');
  assert.strictEqual(
    translator.t('missing', 'Default', { name: 'Ada' }),
    'Default',
  );
  assert.deepStrictEqual(translator.t('nested', { returnObjects: true }), {
    value: 'ok',
  });
  assert.ok(base.cloneInstance({ lng: 'en', initAsync: false }));
});
