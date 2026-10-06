import assert from 'node:assert/strict';
import { randomBytes, scrypt } from 'node:crypto';
import { describe, it, mock } from 'node:test';
import { appInstance } from '../helpers/appInstance.ts';
import {
  hashPassword,
  scryptAsyncWithSaltAsString,
} from '../helpers/crypto.ts';
import { hashToken, userHelpers } from '../models/User.ts';
import { BadRequestError } from '../services/http/httpErrors.ts';
import {
  assertCalledTimes,
  assertNotCalled,
  assertRejectsLike,
  assertRejectsValue,
  assertTextMatch,
} from '../tests/assertions.ts';
import {
  mockRejectedValueOnce,
  mockResolvedValue,
  stubI18n,
} from '../tests/mocks.ts';
import type { TUser } from './User.ts';

// `genTypes.d.ts` is not part of this repo's own tsc program, so `getModel`
// resolves to the untyped fallback here. Same cast the shared test helpers use.
const getUserModel = () => appInstance.getModel('User') as unknown as TUser;

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

const userEmail = 'testing@test.com';
const userPassword = 'SuperNiceSecret123$';

let globalUser: InstanceType<TUser>;

describe('user model', () => {
  it('can create user', async () => {
    globalUser = await getUserModel().create({
      email: userEmail,
      password: userPassword,
      name: {
        nick: 'nickname',
      },
    });

    assert.notStrictEqual(globalUser.id, undefined);
  });

  it('passwords should be hashed', async () => {
    const user = await getUserModel().findOne({
      email: userEmail,
    });
    assert.ok(user);

    assert.notStrictEqual(user.password, userPassword);
  });

  it('passwords should not be changed on other fields save', async () => {
    const user = await getUserModel().findOne({
      email: userEmail,
    });
    assert.ok(user);
    const psw = user.password;
    user.email = 'rrrr';
    await user.save();
    user.email = userEmail;
    await user.save();

    assert.strictEqual(user.password, psw);
  });

  describe('getUserByEmailAndPassword', () => {
    it('should WORK with valid creds', async () => {
      const userModel = getUserModel();
      const user = await userModel.getUserByEmailAndPassword(
        userEmail,
        userPassword,
      );

      if (user) {
        assert.strictEqual(user?.id, globalUser.id);
      }
    });

    it('should NOT with INvalid creds', async () => {
      const userModel = getUserModel();
      const user = await userModel.getUserByEmailAndPassword(
        userEmail,
        'wrongPassword',
      );

      assert.ok(!user);
    });

    it('should NOT with wrong email', async () => {
      const userModel = getUserModel();
      const user = await userModel.getUserByEmailAndPassword(
        'not@exists.com',
        userPassword,
      );

      assert.ok(!user);
    });
  });

  describe('getUserByToken', () => {
    it('should NOT work for non valid token', async () => {
      const user = await getUserModel().getUserByToken('fake one');

      assert.ok(!user);
    });

    it('should  work for VALID token', async () => {
      const token = await globalUser.generateToken();
      const user = await getUserModel().getUserByToken(token.token);
      assert.ok(user);

      assert.strictEqual(user.id, globalUser.id);
    });
  });

  describe('getUserByVerificationToken', () => {
    it('should NOT work for non valid token', async () => {
      await assertRejectsValue(
        getUserModel().getUserByVerificationToken('fake one'),
        new Error('User not exists'),
      );
    });

    it('should  work for VALID token', async () => {
      const token = await userHelpers.generateUserVerificationToken(globalUser);

      const user = await getUserModel().getUserByVerificationToken(token.token);

      assert.strictEqual(user.id, globalUser.id);
    });
  });

  describe('getUserByPasswordRecoveryToken', () => {
    it('should NOT work for non valid token', async () => {
      await assertRejectsValue(
        getUserModel().getUserByPasswordRecoveryToken('fake one'),
        new Error('User not exists'),
      );
    });

    it('should  work for VALID token', async () => {
      const token =
        await userHelpers.generateUserPasswordRecoveryToken(globalUser);

      const user = await getUserModel().getUserByPasswordRecoveryToken(
        token.token,
      );

      assert.strictEqual(user.id, globalUser.id);
    });
  });
});

describe('token security (doc 01)', () => {
  const email = 'token-sec@test.com';
  let user: InstanceType<TUser>;

  it('issues random base64url tokens that differ each call', async () => {
    user = await getUserModel().create({
      email,
      password: 'pw-token-sec',
      name: { nick: 'tokenSecNick' },
    });

    const a = await user.generateToken();
    const b = await user.generateToken();

    assertTextMatch(a.token, /^[A-Za-z0-9_-]{43}$/);
    assertTextMatch(b.token, /^[A-Za-z0-9_-]{43}$/);
    assert.notStrictEqual(a.token, b.token);
  });

  it('stores only the token hash, never the raw token', async () => {
    const { token } = await user.generateToken();
    const doc = await getUserModel().findOne({ email }).orFail();
    const serialized = JSON.stringify(doc);

    assert.ok(!serialized.includes(token));
    assert.ok(serialized.includes(hashToken(token)));
  });

  it('rejects a session token whose `valid` is in the past', async () => {
    const raw = 'expired-session-raw-token';
    await getUserModel().updateOne(
      { email },
      {
        $push: {
          sessionTokens: {
            token: hashToken(raw),
            valid: new Date(Date.now() - 1000),
          },
        },
      },
    );

    const found = await getUserModel().getUserByToken(raw);
    assert.ok(!found);
  });

  it('rejects verification/recovery tokens past `until`', async () => {
    const vRaw = 'expired-verification-raw';
    const rRaw = 'expired-recovery-raw';
    await getUserModel().updateOne(
      { email },
      {
        verificationTokens: [
          { token: hashToken(vRaw), until: new Date(Date.now() - 1000) },
        ],
        passwordRecoveryTokens: [
          { token: hashToken(rRaw), until: new Date(Date.now() - 1000) },
        ],
      },
    );

    await assertRejectsValue(
      getUserModel().getUserByVerificationToken(vRaw),
      new Error('User not exists'),
    );
    await assertRejectsValue(
      getUserModel().getUserByPasswordRecoveryToken(rRaw),
      new Error('User not exists'),
    );
  });

  it('requires an email before generating any auth token', async () => {
    const UserModel = getUserModel();
    const user = new UserModel();
    const helperUser = {
      email: '',
      verificationTokens: [],
      passwordRecoveryTokens: [],
      save: mock.fn(),
    };

    await assertRejectsLike(user.generateToken(), 'Email is required');
    await assertRejectsLike(
      userHelpers.generateUserVerificationToken(helperUser as never),
      'Email is required',
    );
    await assertRejectsLike(
      userHelpers.generateUserPasswordRecoveryToken(helperUser as never),
      'Email is required',
    );
    assertNotCalled(helperUser.save);
  });

  it('initializes a missing session-token array before appending', async () => {
    const UserModel = getUserModel();
    const user = new UserModel({ email: 'fresh-token-array@example.com' });
    // The schema always materialises the array, so the legacy "missing array"
    // shape has to be produced through `set` (the same `$set` the assignment
    // `user.sessionTokens = undefined` compiles down to).
    user.set('sessionTokens', undefined);
    const save = mockResolvedValue(mock.method(user, 'save'), user);

    const generated = await user.generateToken();

    assertTextMatch(generated.token, /^[A-Za-z0-9_-]{43}$/);
    assert.strictEqual(user.sessionTokens.length, 1);
    assertCalledTimes(save, 1);
  });

  describe('concurrent session writes', () => {
    const password = 'session race password';
    // The same 400 as a wrong password, so a client cannot tell the two apart.
    const isWrongPasswordError = (err: unknown) => {
      assert.ok(err instanceof BadRequestError);
      assert.strictEqual(err.status, 400);
      assert.strictEqual(err.i18nKey, 'auth.errorUPValid');
      assert.strictEqual(err.message, 'User/password not valid');
      assert.strictEqual(err.code, undefined);
      return true;
    };
    const expired = () => ({
      token: hashToken('expired-session'),
      valid: new Date(Date.now() - 1000),
    });
    const createUser = async (email: string) => {
      const created = await getUserModel().create({ email, password });
      // An expired entry forces the prune path that used to rewrite the array.
      await getUserModel().updateOne(
        { email },
        { $push: { sessionTokens: expired() } },
      );
      return created;
    };

    it('does not issue a session for a password reset after the read', async () => {
      const model = getUserModel();
      const email = 'session-race-reset@test.com';
      // No expired entry: the plain append path must be guarded too.
      await model.create({ email, password });
      const staleLogin = await model.getUserByEmailAndPassword(email, password);
      assert.ok(staleLogin);

      const reset = await model.findOne({ email }).orFail();
      reset.password = 'a brand new reset password';
      reset.set('sessionTokens', []);
      await reset.save();

      await assert.rejects(staleLogin.generateToken(), isWrongPasswordError);
      const stored = await model.findOne({ email }).orFail();
      assert.strictEqual(stored.sessionTokens.length, 0);
    });

    it('answers a password changed after the read like a wrong password', async () => {
      const model = getUserModel();
      const email = 'session-race-password-only@test.com';
      await model.create({ email, password });
      const staleLogin = await model.getUserByEmailAndPassword(email, password);
      assert.ok(staleLogin);

      // Only the hash changes: the conditioned write matches no document.
      await model.updateOne({ email }, { $set: { password: 'changed-hash' } });

      await assert.rejects(staleLogin.generateToken(), isWrongPasswordError);
    });

    it('keeps both sessions of two concurrent logins and prunes expired ones', async () => {
      const model = getUserModel();
      const email = 'session-race-logins@test.com';
      await createUser(email);
      const a = await model.findOne({ email }).orFail();
      const b = await model.findOne({ email }).orFail();

      const [first, second] = await Promise.all([
        a.generateToken(),
        b.generateToken(),
      ]);

      assert.ok(await model.getUserByToken(first.token));
      assert.ok(await model.getUserByToken(second.token));
      const stored = await model.findOne({ email }).orFail();
      assert.deepStrictEqual(
        stored.sessionTokens.map((t) => t.token).sort(),
        [hashToken(first.token), hashToken(second.token)].sort(),
      );
    });

    it('keeps a logout that lands while a login is in flight', async () => {
      const model = getUserModel();
      const email = 'session-race-logout@test.com';
      const created = await createUser(email);
      const { token: loggedOut } = await created.generateToken();
      const inFlightLogin = await model.findOne({ email }).orFail();

      await model.updateOne(
        { email },
        { $pull: { sessionTokens: { token: hashToken(loggedOut) } } },
      );
      const { token: issued } = await inFlightLogin.generateToken();

      assert.strictEqual(await model.getUserByToken(loggedOut), false);
      assert.ok(await model.getUserByToken(issued));
    });
  });
});

describe('password hashing (doc 02)', () => {
  const pw = 'SharedSecret123$';

  it('gives same-password users different stored hashes (per-user salt)', async () => {
    const u1 = await getUserModel().create({
      email: 'pwhash1@test.com',
      password: pw,
      name: { nick: 'pwhash1' },
    });
    const u2 = await getUserModel().create({
      email: 'pwhash2@test.com',
      password: pw,
      name: { nick: 'pwhash2' },
    });

    assert.ok(u1.password);
    assert.ok(u2.password);
    assertTextMatch(u1.password, /^v2:scrypt:/);
    assertTextMatch(u2.password, /^v2:scrypt:/);
    assert.notStrictEqual(u1.password, u2.password);
  });

  it('round-trips: correct password verifies, wrong password fails', async () => {
    const model = getUserModel();
    const ok = await model.getUserByEmailAndPassword('pwhash1@test.com', pw);
    const bad = await model.getUserByEmailAndPassword(
      'pwhash1@test.com',
      'wrong',
    );

    assert.ok(ok);
    assert.ok(!bad);
  });

  it('upgrades a legacy v1 hash to v2 on successful login', async () => {
    const model = getUserModel();
    const email = 'legacy-v1@test.com';
    await model.create({
      email,
      password: 'placeholder',
      name: { nick: 'legacyV1' },
    });
    // Write a genuine v1 (legacy) hash directly: bare base64url scrypt(pw, AUTH_SALT).
    const legacyHash = await scryptAsyncWithSaltAsString('legacyPass');
    await model.updateOne({ email }, { password: legacyHash });

    // Wrong password fails against a v1 (legacy) stored hash.
    const wrong = await model.getUserByEmailAndPassword(email, 'wrongLegacy');
    assert.ok(!wrong);

    // Login succeeds via the v1 verify path...
    const first = await model.getUserByEmailAndPassword(email, 'legacyPass');
    assert.ok(first);

    // ...and the stored hash is upgraded to v2 (not the double-hashed string).
    const afterFirst = await model.findOne({ email }).orFail();
    assert.ok(afterFirst.password);
    assertTextMatch(afterFirst.password, /^v2:scrypt:/);
    assert.notStrictEqual(afterFirst.password, legacyHash);

    // A second login still succeeds (the pre-save hook did not double-hash).
    const second = await model.getUserByEmailAndPassword(email, 'legacyPass');
    assert.ok(second);
  });

  it('issues a session after an upgrading login without hashing it again', async () => {
    const model = getUserModel();
    const email = 'legacy-v1-session@test.com';
    await model.create({
      email,
      password: 'placeholder',
      name: { nick: 'legacyV1Session' },
    });
    const legacyHash = await scryptAsyncWithSaltAsString('legacyPass');
    await model.updateOne({ email }, { password: legacyHash });

    const user = await model.getUserByEmailAndPassword(email, 'legacyPass');
    assert.ok(user);
    const { token } = await user.generateToken();

    assert.ok(await model.getUserByToken(token));
    assert.ok(await model.getUserByEmailAndPassword(email, 'legacyPass'));
  });

  it('does not overwrite a password reset that wins the rehash race', async () => {
    const model = getUserModel();
    const email = 'rehash-race@test.com';
    await model.create({
      email,
      password: 'placeholder',
      name: { nick: 'rehashRace' },
    });
    const legacyHash = await scryptAsyncWithSaltAsString('oldPass');
    await model.updateOne({ email }, { password: legacyHash });
    const resetHash = await hashPassword('new reset passphrase');
    const originalUpdate = model.updateOne.bind(model);
    const spy = mock.method(model, 'updateOne');
    spy.mock.mockImplementation((...args) => {
      const query = originalUpdate(...args);
      query.pre(async () => {
        await originalUpdate({ email }, { password: resetHash });
      });
      return query;
    });
    try {
      assert.strictEqual(
        await model.getUserByEmailAndPassword(email, 'oldPass'),
        false,
      );
      assert.strictEqual(
        (await model.findOne({ email }).orFail()).password,
        resetHash,
      );
    } finally {
      spy.mock.restore();
    }
    assert.ok(
      await model.getUserByEmailAndPassword(email, 'new reset passphrase'),
    );
  });

  it('rehashes when the stored v2 cost is below the current target', async () => {
    const model = getUserModel();
    const email = 'weak-v2@test.com';
    await model.create({
      email,
      password: 'placeholder',
      name: { nick: 'weakV2' },
    });
    // Construct a valid v2 hash with a cost below the configured target so it
    // triggers a rehash on login. Read the target from config (tests lower it).
    const { saltSecret, scrypt: target } = appInstance.getConfig('auth') as {
      saltSecret: string;
      scrypt: { ln: number; r: number; p: number };
    };
    const salt = randomBytes(16);
    const lowLn = target.ln - 2;
    const hash = await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        `weakPass${saltSecret}`,
        salt,
        64,
        { N: 2 ** lowLn, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
        (err, dk) => (err ? reject(err) : resolve(dk)),
      );
    });
    const weakHash = `v2:scrypt:ln=${lowLn},r=8,p=1:${salt.toString(
      'base64url',
    )}:${hash.toString('base64url')}`;
    await model.updateOne({ email }, { password: weakHash });

    const ok = await model.getUserByEmailAndPassword(email, 'weakPass');
    assert.ok(ok);

    const after = await model.findOne({ email }).orFail();
    const expectedPrefix = `v2:scrypt:ln=${target.ln},r=${target.r},p=${target.p}:`;
    assert.strictEqual(after.password?.startsWith(expectedPrefix), true);
  });

  it('still returns the user when the rehash write fails', async () => {
    const model = getUserModel();
    const email = 'rehash-fail@test.com';
    await model.create({
      email,
      password: 'placeholder',
      name: { nick: 'rehashFail' },
    });
    const legacyHash = await scryptAsyncWithSaltAsString('failPass');
    await model.updateOne({ email }, { password: legacyHash });

    const spy = mockRejectedValueOnce(
      mock.method(model, 'updateOne'),
      new Error('db down') as never,
    );
    const user = await model.getUserByEmailAndPassword(email, 'failPass');
    assert.ok(user);
    spy.mock.restore();
  });

  it('fails cleanly (no throw) on a corrupted or unknown-version hash', async () => {
    const model = getUserModel();
    const email = 'corrupt-hash@test.com';
    await model.create({
      email,
      password: 'placeholder',
      name: { nick: 'corruptHash' },
    });

    // Non-numeric cost, an unknown future scheme version, and a truncated v2
    // string must all resolve to "not valid" rather than 500 the login.
    const badHashes = [
      'v2:scrypt:ln=garbage,r=8,p=1:zzzz:zzzz',
      'v3:scrypt:ln=17,r=8,p=1:zzzz:zzzz',
      'v2:scrypt:ln=17,r=8,p=1',
      // Absurd-but-integer cost: scrypt rejects it (required > maxmem ceiling)
      // rather than attempting a huge allocation.
      'v2:scrypt:ln=40,r=8,p=1:zzzz:zzzz',
    ];
    for (const bad of badHashes) {
      await model.updateOne({ email }, { password: bad });
      const res = await model.getUserByEmailAndPassword(email, 'whatever');
      assert.ok(!res);
    }
  });
});

describe('auth mails for a user with no email address', () => {
  /** A user document that never got an email — the field is optional. */
  const userWithoutEmail = () => {
    const UserModel = getUserModel();
    return new UserModel({ name: { nick: 'noEmailNick' } });
  };

  it('refuses to send the verification mail and reports it', async () => {
    const user = userWithoutEmail();
    const logError = mock.method(appInstance.logger, 'error', () => {});

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
    const logError = mock.method(appInstance.logger, 'error', () => {});

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
