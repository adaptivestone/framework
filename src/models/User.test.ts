import { randomBytes, scrypt } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { appInstance } from '../helpers/appInstance.ts';
import { scryptAsyncWithSaltAsString } from '../helpers/crypto.ts';
import { hashToken, userHelpers } from '../models/User.ts';
import type { TUser } from './User.ts';

const userEmail = 'testing@test.com';
const userPassword = 'SuperNiceSecret123$';

let globalUser: InstanceType<TUser>;

describe('user model', () => {
  it('can create user', async () => {
    expect.assertions(1);

    globalUser = await appInstance.getModel('User').create({
      email: userEmail,
      password: userPassword,
      name: {
        nick: 'nickname',
      },
    });

    expect(globalUser.id).toBeDefined();
  });

  it('passwords should be hashed', async () => {
    expect.assertions(1);

    const user: InstanceType<TUser> = await appInstance
      .getModel('User')
      .findOne({
        email: userEmail,
      });

    expect(user.password).not.toBe(userPassword);
  });

  it('passwords should not be changed on other fields save', async () => {
    expect.assertions(1);

    const user: InstanceType<TUser> = await appInstance
      .getModel('User')
      .findOne({
        email: userEmail,
      });
    const psw = user.password;
    user.email = 'rrrr';
    await user.save();
    user.email = userEmail;
    await user.save();

    expect(user.password).toBe(psw);
  });

  describe('getUserByEmailAndPassword', () => {
    it('should WORK with valid creds', async () => {
      expect.assertions(1);

      const userModel: TUser = await appInstance.getModel('User');
      const user = await userModel.getUserByEmailAndPassword(
        userEmail,
        userPassword,
      );

      if (user) {
        expect(user?.id).toBe(globalUser.id);
      }
    });

    it('should NOT with INvalid creds', async () => {
      expect.assertions(1);

      const userModel: TUser = await appInstance.getModel('User');
      const user = await userModel.getUserByEmailAndPassword(
        userEmail,
        'wrongPassword',
      );

      expect(user).toBeFalsy();
    });

    it('should NOT with wrong email', async () => {
      expect.assertions(1);

      const userModel: TUser = await appInstance.getModel('User');
      const user = await userModel.getUserByEmailAndPassword(
        'not@exists.com',
        userPassword,
      );

      expect(user).toBeFalsy();
    });
  });

  describe('getUserByToken', () => {
    it('should NOT work for non valid token', async () => {
      expect.assertions(1);

      const user: InstanceType<TUser> = await appInstance
        .getModel('User')
        .getUserByToken('fake one');

      expect(user).toBeFalsy();
    });

    it('should  work for VALID token', async () => {
      expect.assertions(1);

      const token = await globalUser.generateToken();
      const user: InstanceType<TUser> = await appInstance
        .getModel('User')
        .getUserByToken(token.token);

      expect(user.id).toBe(globalUser.id);
    });
  });

  describe('getUserByVerificationToken', () => {
    it('should NOT work for non valid token', async () => {
      expect.assertions(1);

      await expect(
        appInstance.getModel('User').getUserByVerificationToken('fake one'),
      ).rejects.toStrictEqual(new Error('User not exists'));
    });

    it('should  work for VALID token', async () => {
      expect.assertions(1);

      const token = await userHelpers.generateUserVerificationToken(globalUser);

      const user = await appInstance
        .getModel('User')
        .getUserByVerificationToken(token.token);

      expect(user.id).toBe(globalUser.id);
    });
  });

  describe('getUserByPasswordRecoveryToken', () => {
    it('should NOT work for non valid token', async () => {
      expect.assertions(1);

      await expect(
        appInstance.getModel('User').getUserByPasswordRecoveryToken('fake one'),
      ).rejects.toStrictEqual(new Error('User not exists'));
    });

    it('should  work for VALID token', async () => {
      expect.assertions(1);

      const token =
        await userHelpers.generateUserPasswordRecoveryToken(globalUser);

      const user = await appInstance
        .getModel('User')
        .getUserByPasswordRecoveryToken(token.token);

      expect(user.id).toBe(globalUser.id);
    });
  });
});

describe('token security (doc 01)', () => {
  const email = 'token-sec@test.com';
  let user: InstanceType<TUser>;

  it('issues random base64url tokens that differ each call', async () => {
    expect.assertions(3);

    user = await appInstance.getModel('User').create({
      email,
      password: 'pw-token-sec',
      name: { nick: 'tokenSecNick' },
    });

    const a = await user.generateToken();
    const b = await user.generateToken();

    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
  });

  it('stores only the token hash, never the raw token', async () => {
    expect.assertions(2);

    const { token } = await user.generateToken();
    const doc = await appInstance.getModel('User').findOne({ email }).orFail();
    const serialized = JSON.stringify(doc);

    expect(serialized).not.toContain(token);
    expect(serialized).toContain(hashToken(token));
  });

  it('rejects a session token whose `valid` is in the past', async () => {
    expect.assertions(1);

    const raw = 'expired-session-raw-token';
    await appInstance.getModel('User').updateOne(
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

    const found = await appInstance.getModel('User').getUserByToken(raw);
    expect(found).toBeFalsy();
  });

  it('rejects verification/recovery tokens past `until`', async () => {
    expect.assertions(2);

    const vRaw = 'expired-verification-raw';
    const rRaw = 'expired-recovery-raw';
    await appInstance.getModel('User').updateOne(
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

    await expect(
      appInstance.getModel('User').getUserByVerificationToken(vRaw),
    ).rejects.toStrictEqual(new Error('User not exists'));
    await expect(
      appInstance.getModel('User').getUserByPasswordRecoveryToken(rRaw),
    ).rejects.toStrictEqual(new Error('User not exists'));
  });
});

describe('password hashing (doc 02)', () => {
  const pw = 'SharedSecret123$';

  it('gives same-password users different stored hashes (per-user salt)', async () => {
    expect.assertions(3);

    const u1 = await appInstance.getModel('User').create({
      email: 'pwhash1@test.com',
      password: pw,
      name: { nick: 'pwhash1' },
    });
    const u2 = await appInstance.getModel('User').create({
      email: 'pwhash2@test.com',
      password: pw,
      name: { nick: 'pwhash2' },
    });

    expect(u1.password).toMatch(/^v2:scrypt:/);
    expect(u2.password).toMatch(/^v2:scrypt:/);
    expect(u1.password).not.toBe(u2.password);
  });

  it('round-trips: correct password verifies, wrong password fails', async () => {
    expect.assertions(2);

    const model = appInstance.getModel('User') as unknown as TUser;
    const ok = await model.getUserByEmailAndPassword('pwhash1@test.com', pw);
    const bad = await model.getUserByEmailAndPassword(
      'pwhash1@test.com',
      'wrong',
    );

    expect(ok).toBeTruthy();
    expect(bad).toBeFalsy();
  });

  it('upgrades a legacy v1 hash to v2 on successful login', async () => {
    expect.assertions(5);

    const model = appInstance.getModel('User') as unknown as TUser;
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
    expect(wrong).toBeFalsy();

    // Login succeeds via the v1 verify path...
    const first = await model.getUserByEmailAndPassword(email, 'legacyPass');
    expect(first).toBeTruthy();

    // ...and the stored hash is upgraded to v2 (not the double-hashed string).
    const afterFirst = await model.findOne({ email }).orFail();
    expect(afterFirst.password).toMatch(/^v2:scrypt:/);
    expect(afterFirst.password).not.toBe(legacyHash);

    // A second login still succeeds (the pre-save hook did not double-hash).
    const second = await model.getUserByEmailAndPassword(email, 'legacyPass');
    expect(second).toBeTruthy();
  });

  it('rehashes when the stored v2 cost is below the current target', async () => {
    expect.assertions(2);

    const model = appInstance.getModel('User') as unknown as TUser;
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
    expect(ok).toBeTruthy();

    const after = await model.findOne({ email }).orFail();
    const expectedPrefix = `v2:scrypt:ln=${target.ln},r=${target.r},p=${target.p}:`;
    expect(after.password?.startsWith(expectedPrefix)).toBe(true);
  });

  it('still returns the user when the rehash write fails', async () => {
    expect.assertions(1);

    const model = appInstance.getModel('User') as unknown as TUser;
    const email = 'rehash-fail@test.com';
    await model.create({
      email,
      password: 'placeholder',
      name: { nick: 'rehashFail' },
    });
    const legacyHash = await scryptAsyncWithSaltAsString('failPass');
    await model.updateOne({ email }, { password: legacyHash });

    const spy = vi
      .spyOn(model, 'updateOne')
      .mockRejectedValueOnce(new Error('db down') as never);
    const user = await model.getUserByEmailAndPassword(email, 'failPass');
    expect(user).toBeTruthy();
    spy.mockRestore();
  });

  it('fails cleanly (no throw) on a corrupted or unknown-version hash', async () => {
    expect.assertions(4);

    const model = appInstance.getModel('User') as unknown as TUser;
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
      expect(res).toBeFalsy();
    }
  });
});
