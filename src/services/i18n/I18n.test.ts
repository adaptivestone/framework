import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { appInstance } from '../../helpers/appInstance.ts';
import type { TI18n } from './I18n.ts';

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
});
