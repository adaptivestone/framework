import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertRejectsLike } from '../tests/assertions.ts';
import { appInstance } from './appInstance.ts';
import { hashPassword, verifyPassword } from './crypto.ts';

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
