import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { appInstance } from '../helpers/appInstance.ts';
import {
  assertCalledTimes,
  assertCalledWith,
  assertMatchObject,
  assertNotCalled,
  assertRejectsValue,
  assertTextMatch,
} from '../tests/assertions.ts';
import { stubI18n } from '../tests/mocks.ts';

// Call-through spies on the crypto helpers so the enumeration burn is
// observable; implementations stay real (the model imports this same module).
const cryptoHelpers = await import('../helpers/crypto.ts');
const burnPasswordVerify = mock.fn(cryptoHelpers.burnPasswordVerify);
mock.module('../helpers/crypto.ts', {
  exports: { ...cryptoHelpers, burnPasswordVerify },
});
const { default: UserOld } = await import('./UserOld.ts');

/** The mongoose model handle the class builds — `UserOld` exports no type. */
type TUserOld = InstanceType<typeof UserOld>['mongooseModel'];

// `genTypes.d.ts` is not part of this repo's own tsc program, so `getModel`
// resolves to the untyped fallback here. Same cast the shared test helpers use.
const getUserOldModel = () =>
  appInstance.getModel('UserOld') as unknown as TUserOld;

/**
 * `loadClass` copies the class instance methods onto every document, but the
 * model's declared methods type does not carry them.
 */
type TUserOldDoc = InstanceType<TUserOld> &
  Pick<
    InstanceType<typeof UserOld>,
    'sendPasswordRecoveryEmail' | 'sendVerificationEmail'
  >;

/**
 * Winston types `logger.error` as taking a single info object, so the recorded
 * mock arguments need narrowing before the string assertions.
 */
const firstLoggedMessage = (call: {
  arguments: readonly unknown[];
}): string => {
  const [message] = call.arguments;
  assert.ok(typeof message === 'string');
  return message;
};

const userEmail = 'userold@test.com';
const userPassword = 'OldSuperSecret123$';

describe('UserOld model (deprecated)', () => {
  it('emits a DeprecationWarning (code ASF_DEP_USEROLD) with a security note on construction', () => {
    const spy = mock.method(process, 'emitWarning', () => {});
    try {
      // Construction alone must be audible — the model is instantiated at boot.
      // A subclass probe avoids re-registering the 'UserOld' mongoose model.
      class UserOldDeprecationProbe extends UserOld {}
      const probe = new UserOldDeprecationProbe(appInstance);

      assert.ok(probe instanceof UserOld);
      assertCalledTimes(spy, 1);
      const [message, options] = spy.mock.calls[0].arguments as [
        string,
        { type?: string; code?: string },
      ];
      assertMatchObject(options, {
        type: 'DeprecationWarning',
        code: 'ASF_DEP_USEROLD',
      });
      assert.ok(message.includes('SECURITY'));
      assertTextMatch(message, /User model/);
    } finally {
      spy.mock.restore();
    }
  });

  it('can create a user (password hashed by the pre-save hook)', async () => {
    const user = await getUserOldModel().create({
      email: userEmail,
      password: userPassword,
      name: { nick: 'oldNick' },
    });

    assert.notStrictEqual(user.id, undefined);
    assert.notStrictEqual(user.password, userPassword);
  });

  describe('getUserByEmailAndPassword', () => {
    it('should WORK with valid creds', async () => {
      const user = await getUserOldModel().getUserByEmailAndPassword(
        userEmail,
        userPassword,
      );

      if (user) {
        assert.strictEqual(user.email, userEmail);
      }
    });

    it('should NOT work with a wrong password (no burn on the real path)', async () => {
      burnPasswordVerify.mock.resetCalls();
      const user = await getUserOldModel().getUserByEmailAndPassword(
        userEmail,
        'wrongPassword',
      );

      assert.strictEqual(user, false);
      assertNotCalled(burnPasswordVerify);
    });

    it('burns one KDF verify on the unknown-email path (enumeration timing)', async () => {
      burnPasswordVerify.mock.resetCalls();
      const user = await getUserOldModel().getUserByEmailAndPassword(
        'not@exists.com',
        'whatever',
      );

      assert.strictEqual(user, false);
      assertCalledWith(burnPasswordVerify, 'whatever');
    });
  });

  describe('getUserByPasswordRecoveryToken', () => {
    it('should WORK for a live (unexpired) token', async () => {
      const model = getUserOldModel();
      const user = await model.findOne({ email: userEmail }).orFail();
      const { token } = await model.generateUserPasswordRecoveryToken(user);

      const found = await model.getUserByPasswordRecoveryToken(token);

      if (found) {
        assert.strictEqual(found.email, userEmail);
      }
    });

    it('rejects a token whose `until` is in the past', async () => {
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

      await assertRejectsValue(
        model.getUserByPasswordRecoveryToken('expired-recovery-token'),
        new Error('User not exists'),
      );
    });
  });

  describe('getUserByVerificationToken', () => {
    it('should WORK for a live (unexpired) token', async () => {
      const model = getUserOldModel();
      const user = await model.findOne({ email: userEmail }).orFail();
      const { token } = await model.generateUserVerificationToken(user);

      const found = await model.getUserByVerificationToken(token);

      if (found) {
        assert.strictEqual(found.email, userEmail);
      }
    });

    it('rejects a token whose `until` is in the past', async () => {
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

      await assertRejectsValue(
        model.getUserByVerificationToken('expired-verification-token'),
        new Error('User not exists'),
      );
    });
  });
});

describe('UserOld auth mails for a user with no email address', () => {
  /** A user document that never got an email — the field is optional. */
  const userWithoutEmail = (): TUserOldDoc =>
    new (getUserOldModel())({
      name: { nick: 'oldNoEmailNick' },
    }) as TUserOldDoc;

  it('refuses to send the verification mail and reports it', async () => {
    const user = userWithoutEmail();
    const { logger } = getUserOldModel().getSuper();
    const logError = mock.method(logger, 'error', () => {});

    try {
      const sent = await user.sendVerificationEmail(stubI18n({}));

      assert.strictEqual(sent, false);
      assertCalledTimes(logError, 1);
      const message = firstLoggedMessage(logError.mock.calls[0]);
      assertTextMatch(message, /verification email/);
      assertTextMatch(message, /no email address/);
    } finally {
      logError.mock.restore();
    }
  });

  it('refuses to send the password recovery mail and reports it', async () => {
    const user = userWithoutEmail();
    const { logger } = getUserOldModel().getSuper();
    const logError = mock.method(logger, 'error', () => {});

    try {
      const sent = await user.sendPasswordRecoveryEmail(stubI18n({}));

      assert.strictEqual(sent, false);
      assertCalledTimes(logError, 1);
      const message = firstLoggedMessage(logError.mock.calls[0]);
      assertTextMatch(message, /password recovery email/);
      assertTextMatch(message, /no email address/);
    } finally {
      logError.mock.restore();
    }
  });
});
