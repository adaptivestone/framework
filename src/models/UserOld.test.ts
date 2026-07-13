import { describe, expect, it, vi } from 'vitest';
import { appInstance } from '../helpers/appInstance.ts';
import { burnPasswordVerify } from '../helpers/crypto.ts';
import UserOld from './UserOld.ts';

// Call-through spies on the crypto helpers so the enumeration burn is
// observable; implementations stay real (the model imports this same module).
vi.mock('../helpers/crypto.ts', { spy: true });

const userEmail = 'userold@test.com';
const userPassword = 'OldSuperSecret123$';

describe('UserOld model (deprecated)', () => {
  const getUserOldModel = () => appInstance.getModel('UserOld');

  it('emits a DeprecationWarning (code ASF_DEP_USEROLD) with a security note on construction', () => {
    expect.assertions(5);

    const spy = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      // Construction alone must be audible — the model is instantiated at boot.
      // A subclass probe avoids re-registering the 'UserOld' mongoose model.
      class UserOldDeprecationProbe extends UserOld {}
      const probe = new UserOldDeprecationProbe(appInstance);

      expect(probe).toBeInstanceOf(UserOld);
      expect(spy).toHaveBeenCalledTimes(1);
      const [message, options] = spy.mock.calls[0] as [
        string,
        { type?: string; code?: string },
      ];
      expect(options).toMatchObject({
        type: 'DeprecationWarning',
        code: 'ASF_DEP_USEROLD',
      });
      expect(message).toContain('SECURITY');
      expect(message).toMatch(/User model/);
    } finally {
      spy.mockRestore();
    }
  });

  it('can create a user (password hashed by the pre-save hook)', async () => {
    expect.assertions(2);

    const user = await getUserOldModel().create({
      email: userEmail,
      password: userPassword,
      name: { nick: 'oldNick' },
    });

    expect(user.id).toBeDefined();
    expect(user.password).not.toBe(userPassword);
  });

  describe('getUserByEmailAndPassword', () => {
    it('should WORK with valid creds', async () => {
      expect.assertions(1);

      const user = await getUserOldModel().getUserByEmailAndPassword(
        userEmail,
        userPassword,
      );

      if (user) {
        expect(user.email).toBe(userEmail);
      }
    });

    it('should NOT work with a wrong password (no burn on the real path)', async () => {
      expect.assertions(2);

      vi.mocked(burnPasswordVerify).mockClear();
      const user = await getUserOldModel().getUserByEmailAndPassword(
        userEmail,
        'wrongPassword',
      );

      expect(user).toBe(false);
      expect(burnPasswordVerify).not.toHaveBeenCalled();
    });

    it('burns one KDF verify on the unknown-email path (enumeration timing)', async () => {
      expect.assertions(2);

      vi.mocked(burnPasswordVerify).mockClear();
      const user = await getUserOldModel().getUserByEmailAndPassword(
        'not@exists.com',
        'whatever',
      );

      expect(user).toBe(false);
      expect(burnPasswordVerify).toHaveBeenCalledWith('whatever');
    });
  });

  describe('getUserByPasswordRecoveryToken', () => {
    it('should WORK for a live (unexpired) token', async () => {
      expect.assertions(1);

      const model = getUserOldModel();
      const user = await model.findOne({ email: userEmail }).orFail();
      const { token } = await model.generateUserPasswordRecoveryToken(user);

      const found = await model.getUserByPasswordRecoveryToken(token);

      if (found) {
        expect(found.email).toBe(userEmail);
      }
    });

    it('rejects a token whose `until` is in the past', async () => {
      expect.assertions(1);

      const model = getUserOldModel();
      await model.updateOne(
        { email: userEmail },
        {
          passwordRecoveryTokens: [
            {
              token: 'expired-recovery-token',
              until: new Date(Date.now() - 1000),
            },
          ],
        },
      );

      await expect(
        model.getUserByPasswordRecoveryToken('expired-recovery-token'),
      ).rejects.toStrictEqual(new Error('User not exists'));
    });
  });

  describe('getUserByVerificationToken', () => {
    it('should WORK for a live (unexpired) token', async () => {
      expect.assertions(1);

      const model = getUserOldModel();
      const user = await model.findOne({ email: userEmail }).orFail();
      const { token } = await model.generateUserVerificationToken(user);

      const found = await model.getUserByVerificationToken(token);

      if (found) {
        expect(found.email).toBe(userEmail);
      }
    });

    it('rejects a token whose `until` is in the past', async () => {
      expect.assertions(1);

      const model = getUserOldModel();
      await model.updateOne(
        { email: userEmail },
        {
          verificationTokens: [
            {
              token: 'expired-verification-token',
              until: new Date(Date.now() - 1000),
            },
          ],
        },
      );

      await expect(
        model.getUserByVerificationToken('expired-verification-token'),
      ).rejects.toStrictEqual(new Error('User not exists'));
    });
  });
});
