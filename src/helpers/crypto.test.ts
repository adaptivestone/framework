import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertRejectsLike } from '../tests/assertions.ts';
import { appInstance } from './appInstance.ts';
import {
  hashPassword,
  hashSecret,
  timingSafeEqualStrings,
  verifyPassword,
  verifySecret,
} from './crypto.ts';

describe('crypto failure guards', () => {
  it('fails clearly when AUTH_SALT is missing', async () => {
    const auth = appInstance.getConfig('auth') as { saltSecret?: string };
    const original = auth.saltSecret;
    auth.saltSecret = '';
    try {
      await assertRejectsLike(
        hashPassword('password'),
        'AUTH_SALT is not defined',
      );
    } finally {
      auth.saltSecret = original;
    }
  });

  it('rejects an invalid scrypt cost through the async wrapper', async () => {
    const auth = appInstance.getConfig('auth') as {
      scrypt: { ln: number; r: number; p: number };
    };
    const original = auth.scrypt;
    auth.scrypt = { ln: 40, r: 8, p: 1 };
    try {
      await assertRejectsLike(hashPassword('password'), Error);
    } finally {
      auth.scrypt = original;
    }
  });

  it('rejects a v2 hash with an unsupported algorithm', async () => {
    await assert.deepStrictEqual(
      await verifyPassword('password', 'v2:argon:ln=1,r=1,p=1:AA:AA'),
      { valid: false, needsRehash: false },
    );
  });
});

describe('hashSecret / verifySecret', () => {
  const purpose = { purpose: 'email-login' };

  it('is deterministic for the same value and purpose', () => {
    assert.strictEqual(
      hashSecret('042017', purpose),
      hashSecret('042017', purpose),
    );
  });

  it('gives different hashes for different values or purposes', () => {
    const hash = hashSecret('042017', purpose);
    assert.notStrictEqual(hashSecret('042018', purpose), hash);
    assert.notStrictEqual(hashSecret('042017', { purpose: 'sms' }), hash);
  });

  it('keeps the stored format stable', () => {
    // Stored hashes depend on this exact recipe; a change here invalidates
    // every outstanding code.
    const auth = appInstance.getConfig('auth') as { saltSecret?: string };
    const original = auth.saltSecret;
    auth.saltSecret = 'test-salt-secret';
    try {
      assert.strictEqual(
        hashSecret('042017', purpose),
        'wjL6885W0MJXW0rLsvIdhowSiL7xjB3azgZAhM_dvIE',
      );
    } finally {
      auth.saltSecret = original;
    }
  });

  it('fails clearly when AUTH_SALT is missing', () => {
    const auth = appInstance.getConfig('auth') as { saltSecret?: string };
    const original = auth.saltSecret;
    auth.saltSecret = '';
    try {
      assert.throws(
        () => hashSecret('042017', purpose),
        /AUTH_SALT is not defined/,
      );
    } finally {
      auth.saltSecret = original;
    }
  });

  it('requires a purpose', () => {
    assert.throws(
      () => hashSecret('042017', { purpose: '' }),
      /purpose is required/,
    );
  });

  it('verifies only the same value under the same purpose', () => {
    const stored = hashSecret('042017', purpose);
    assert.strictEqual(verifySecret('042017', stored, purpose), true);
    assert.strictEqual(verifySecret('999999', stored, purpose), false);
    assert.strictEqual(
      verifySecret('042017', stored, { purpose: 'sms' }),
      false,
    );
  });

  it('rejects a truncated or malformed stored hash', () => {
    const stored = hashSecret('042017', purpose);
    assert.strictEqual(
      verifySecret('042017', stored.slice(0, -2), purpose),
      false,
    );
    assert.strictEqual(verifySecret('042017', '042017', purpose), false);
    assert.strictEqual(verifySecret('042017', '', purpose), false);
  });
});

describe('timingSafeEqualStrings', () => {
  it('is true only for identical strings', () => {
    assert.strictEqual(
      timingSafeEqualStrings('probe-secret', 'probe-secret'),
      true,
    );
    assert.strictEqual(
      timingSafeEqualStrings('probe-secret', 'probe-secreT'),
      false,
    );
    assert.strictEqual(
      timingSafeEqualStrings('short', 'a much longer value'),
      false,
    );
    assert.strictEqual(timingSafeEqualStrings('', ''), true);
  });
});
