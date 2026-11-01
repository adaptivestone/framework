import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type ThttpConfig from '../../config/http.ts';
import { securityHeaders } from './securityHeaders.ts';

describe('securityHeaders', () => {
  it('lists the configured string headers while enabled, nothing while disabled', () => {
    let config = {
      securityHeaders: {
        enabled: true,
        'X-Frame-Options': 'DENY',
        'Strict-Transport-Security': null,
      },
    } as unknown as typeof ThttpConfig;
    const headers = securityHeaders(() => config);

    assert.deepStrictEqual(headers(), [['X-Frame-Options', 'DENY']]);

    // `enabled` is read on each call; the list itself is fixed at startup.
    config = {
      securityHeaders: { ...config.securityHeaders, enabled: false },
    } as typeof ThttpConfig;
    assert.deepStrictEqual(headers(), []);
  });
});
