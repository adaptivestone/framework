import { describe, expect, it } from 'vitest';
import { appInstance } from './appInstance.ts';
import { hashPassword, verifyPassword } from './crypto.ts';

describe('crypto failure guards', () => {
  it('fails clearly when AUTH_SALT is missing', async () => {
    const auth = appInstance.getConfig('auth') as { saltSecret?: string };
    const original = auth.saltSecret;
    auth.saltSecret = '';
    try {
      await expect(hashPassword('password')).rejects.toThrow(
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
      await expect(hashPassword('password')).rejects.toBeInstanceOf(Error);
    } finally {
      auth.scrypt = original;
    }
  });

  it('rejects a v2 hash with an unsupported algorithm', async () => {
    await expect(
      verifyPassword('password', 'v2:argon:ln=1,r=1,p=1:AA:AA'),
    ).resolves.toEqual({ valid: false, needsRehash: false });
  });
});
