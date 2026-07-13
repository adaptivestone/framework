import { beforeAll, describe, expect, it, vi } from 'vitest';
import Transport from 'winston-transport';
import { appInstance } from '../helpers/appInstance.ts';
import type { TUser } from '../models/User.ts';
import { hashToken, userHelpers } from '../models/User.ts';
import { getTestServerURL } from '../tests/testHelpers.ts';

const userEmail = 'testing@test.com';
const userPassword = 'SuperNiceSecret123$';

const userEmail2 = 'testing2@test.com';

// Records every log entry the app logger emits, so a test can assert a secret
// never appears. `silly` level captures verbose/debug/info too.
class CaptureTransport extends Transport {
  sink: string[];
  constructor(sink: string[]) {
    super({ level: 'silly' });
    this.sink = sink;
  }
  log(info: unknown, callback: () => void) {
    this.sink.push(JSON.stringify(info));
    callback();
  }
}

describe('auth', () => {
  describe('registration', () => {
    it('code NOT able to create user with wrong email', async () => {
      expect.assertions(1);

      const { status } = await fetch(getTestServerURL('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: 'bad email',
          password: userPassword,
          nickName: 'test',
        }),
      }).catch(() => ({ status: 500 }));

      expect(status).toBe(400);
    });

    it('translates i18n keys in validation error response', async () => {
      expect.assertions(3);

      const response = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);

      const body = (await response.json()) as {
        errors: Record<string, string | string[]>;
      };
      // Schema declares messages as i18n keys (`auth.emailProvided`,
      // `auth.passwordProvided`); framework auto-translates via the
      // request's i18n.t before sending the response.
      expect(body.errors.email).toEqual(['Email must be provided']);
      expect(body.errors.password).toEqual(['Password must be provided']);
    });

    it('can create user', async () => {
      expect.assertions(1);

      const { status } = await fetch(getTestServerURL('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
          nickName: 'test',
        }),
      });

      expect(status).toBe(201);
    });

    it('can  not create user with the same nickname', async () => {
      expect.assertions(1);

      await fetch(getTestServerURL('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
          nickName: 'test',
        }),
      });

      const { status } = await fetch(getTestServerURL('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail2,
          password: '123',
          nickName: 'test',
        }),
      }).catch(() => ({ status: 500 }));

      expect(status).toBe(400);
    });

    it('can NOT create SAME user', async () => {
      expect.assertions(1);

      const { status } = await fetch(getTestServerURL('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
          nickName: 'test',
        }),
      });

      expect(status).toBe(400);
    });
  });

  describe('login', () => {
    it('can NOT login with normal creds and not verified email', async () => {
      expect.assertions(1);

      const { status } = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
        }),
      }).catch(() => ({ status: 500 }));

      expect(status).toBe(400);
    });

    it('can NOT login with WRONG creds', async () => {
      expect.assertions(1);

      const { status } = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: 'test@test.by',
          password: 'noPassword$',
        }),
      }).catch(() => ({ status: 500 }));

      expect(status).toBe(400);
    });

    it('rejects a non-string password with 400 (not 500)', async () => {
      expect.assertions(1);

      const { status } = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', password: ['x'] }),
      }).catch(() => ({ status: 500 }));

      expect(status).toBe(400);
    });

    it('can login with normal creds and verified email', async () => {
      expect.assertions(3);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      const user = await UserModel.findOne({
        email: userEmail,
      });
      if (user) {
        user.isVerified = true;
        await user.save();
      }

      const response = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
        }),
      });

      const responseBody = await response.json();

      expect(response.status).toBe(200);
      expect(responseBody.data).toBeDefined();
      expect(responseBody.data.token).toBeDefined();
    });
  });

  describe('isAuthWithVerificationFlow auth option', () => {
    it('can verify user', async () => {
      expect.assertions(2);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      const user = await UserModel.create({
        email: 'Test@gmail.com',
        password: 'userPassword',
        name: {
          nick: 'nickname',
        },
      });

      // Tokens are stored hashed; generate through the helper to get a raw
      // token to send while the DB holds only its hash.
      const { token } = await userHelpers.generateUserVerificationToken(user);

      const { status } = await fetch(
        `${getTestServerURL('/auth/verify')}?verification_token=${token}`,
        {
          method: 'POST',
        },
      );

      const { isVerified } = await UserModel.findOne({
        email: 'Test@gmail.com',
      }).orFail();

      expect(status).toBe(200);
      expect(isVerified).toBeTruthy();
    });

    it('can not verify user with wrong token', async () => {
      expect.assertions(2);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      const user = await UserModel.create({
        email: 'Test423@gmail.com',
        password: 'userPassword',
        name: {
          nick: 'nicknameee',
        },
      });

      user.verificationTokens?.push({
        token: 'testToken',
      });

      await user.save();

      const { status } = await fetch(
        `${getTestServerURL(
          '/auth/verify',
        )}?verification_token=testToken123wrong`,
        {
          method: 'POST',
        },
      );

      const { isVerified } = await UserModel.findOne({
        email: 'Test423@gmail.com',
      }).orFail();

      expect(status).toBe(400);
      expect(isVerified).toBeFalsy();
    });

    it('send-recovery-email is identical for known and unknown emails (no enumeration, doc 19)', async () => {
      expect.assertions(2);

      const post = (email: string) =>
        fetch(getTestServerURL('/auth/send-recovery-email'), {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });

      const known = await post(userEmail);
      const unknown = await post('notExists@gmail.com');

      expect(unknown.status).toBe(known.status);
      expect(await unknown.text()).toBe(await known.text());
    });

    it('can send recovery to exist email', async () => {
      expect.assertions(1);

      const { status } = await fetch(
        getTestServerURL('/auth/send-recovery-email'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            email: userEmail,
          }),
        },
      );

      expect(status).toBe(200);
    });

    it('send-recovery-email still creates a recovery token for a known user (doc 19)', async () => {
      expect.assertions(1);
      const UserModel = appInstance.getModel('User') as unknown as TUser;
      const email = 'rec-token@example.com';
      await UserModel.create({
        email,
        password: 'userPassword',
        name: { nick: 'recTokenNick' },
      });

      await fetch(getTestServerURL('/auth/send-recovery-email'), {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      // The dispatch (which generates + stores the recovery token) is now
      // fire-and-forget, so poll briefly until the token lands.
      let count = 0;
      for (let i = 0; i < 50 && count === 0; i += 1) {
        const user = await UserModel.findOne({ email }).orFail();
        count = user.passwordRecoveryTokens?.length ?? 0;
        if (count === 0) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
      expect(count).toBeGreaterThan(0);
    });

    it('does not log the password hash during recovery (doc 20)', async () => {
      expect.assertions(2);
      const UserModel = appInstance.getModel('User') as unknown as TUser;
      const created = await UserModel.create({
        email: 'logleak@example.com',
        password: 'userPassword',
        name: { nick: 'logleakNick' },
      });
      const { token } =
        await userHelpers.generateUserPasswordRecoveryToken(created);
      const hash = (await UserModel.findById(created._id).orFail()).password;

      const captured: string[] = [];
      const transport = new CaptureTransport(captured);
      appInstance.logger.add(transport);
      try {
        await fetch(getTestServerURL('/auth/recover-password'), {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            password: 'newPass',
            passwordRecoveryToken: token,
          }),
        });
      } finally {
        appInstance.logger.remove(transport);
      }

      const all = captured.join('\n');
      expect(all).not.toContain(hash);
      expect(all).not.toContain(token);
    });

    it('can recover password', async () => {
      expect.assertions(1);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      const user = await UserModel.create({
        email: 'Test1@gmail.com',
        password: 'userPassword',
        name: {
          nick: 'nickname1',
        },
      });

      // Tokens are stored hashed; generate through the helper to get a raw
      // token to send while the DB holds only its hash.
      const { token } =
        await userHelpers.generateUserPasswordRecoveryToken(user);

      const { status } = await fetch(
        getTestServerURL('/auth/recover-password'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            password: 'newPass',
            passwordRecoveryToken: token,
          }),
        },
      );

      expect(status).toBe(200);
    });

    it('can not recover password with wrong token', async () => {
      expect.assertions(1);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      const user = await UserModel.create({
        email: 'Test2@gmail.com',
        password: 'userPassword',
        name: {
          nick: 'nickname2',
        },
      });

      user.passwordRecoveryTokens?.push({
        token: 'superPassword',
      });

      await user.save();

      const { status } = await fetch(
        getTestServerURL('/auth/recover-password'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            password: 'newPass',
            passwordRecoveryToken: '13123',
          }),
        },
      );

      expect(status).toBe(400);
    });

    it('can login with normal creds and NOT verifyed email if option isAuthWithVerificationFlow is set', async () => {
      expect.assertions(4);

      const { status } = await fetch(getTestServerURL('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail2,
          password: userPassword,
        }),
      });

      const { status: status2 } = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail2,
          password: userPassword,
        }),
      });

      appInstance.updateConfig('auth', {
        isAuthWithVerificationFlow: false,
      });

      const response3 = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail2,
          password: userPassword,
        }),
      });

      const responseBody3 = await response3.json();

      expect(status).toBe(201);
      expect(status2).toBe(400);
      expect(response3.status).toBe(200);
      expect(responseBody3.data.token).toBeDefined();
    });
  });

  it('can user send verification', async () => {
    expect.assertions(1);

    const { status } = await fetch(
      getTestServerURL('/auth/send-verification'),
      {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail2,
        }),
      },
    );

    expect(status).toBe(200);
  });

  it('send-verification is identical for known and unknown emails (no enumeration, doc 19)', async () => {
    expect.assertions(2);

    const post = (email: string) =>
      fetch(getTestServerURL('/auth/send-verification'), {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });

    const known = await post(userEmail2);
    const unknown = await post('wrong@gmail.com');

    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(await known.text());
  });

  describe('logout', () => {
    it('can logout', async () => {
      expect.assertions(3);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      // 1. Create and verify user
      await UserModel.create({
        email: 'logout@test.com',
        password: 'password123',
        name: { nick: 'logoutNick' },
        isVerified: true,
      });

      // 2. Login to get token
      const loginResponse = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({
          email: 'logout@test.com',
          password: 'password123',
        }),
      });
      const loginData = await loginResponse.json();
      const token = loginData.data.token.token;

      // 3. Verify token in DB (stored hashed, so match by hash)
      let userInDb = await UserModel.findOne({ email: 'logout@test.com' });
      const hasToken = userInDb?.sessionTokens?.some(
        (t) => t.token === hashToken(token),
      );
      expect(hasToken).toBeTruthy();

      // 4. Logout
      const logoutResponse = await fetch(getTestServerURL('/auth/logout'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(logoutResponse.status).toBe(200);

      // 5. Verify token removed
      userInDb = await UserModel.findOne({ email: 'logout@test.com' });
      const hasTokenAfter = userInDb?.sessionTokens?.some(
        (t) => t.token === hashToken(token),
      );
      expect(hasTokenAfter).toBeFalsy();
    });

    it('can logout with token in the body', async () => {
      expect.assertions(3);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      const user = await UserModel.create({
        email: 'logout-body@test.com',
        password: 'password123',
        name: { nick: 'logoutBodyNick' },
        isVerified: true,
      });
      // Mint a session token directly (raw returned, hash persisted) — the same
      // 30-day token a body-token client authenticates with.
      const { token } = await user.generateToken();

      let userInDb = await UserModel.findOne({ email: 'logout-body@test.com' });
      const hasToken = userInDb?.sessionTokens?.some(
        (t) => t.token === hashToken(token),
      );
      expect(hasToken).toBeTruthy();

      const logoutResponse = await fetch(getTestServerURL('/auth/logout'), {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      expect(logoutResponse.status).toBe(200);

      userInDb = await UserModel.findOne({ email: 'logout-body@test.com' });
      const hasTokenAfter = userInDb?.sessionTokens?.some(
        (t) => t.token === hashToken(token),
      );
      expect(hasTokenAfter).toBeFalsy();
    });

    it('revokes the body (authenticated) token when both body and header tokens are present', async () => {
      expect.assertions(3);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      const user = await UserModel.create({
        email: 'logout-both@test.com',
        password: 'password123',
        name: { nick: 'logoutBothNick' },
        isVerified: true,
      });
      // The middleware authenticates with the body token, so that is the
      // session logout must revoke; the header token's session must survive.
      const { token: bodyToken } = await user.generateToken();
      const { token: headerToken } = await user.generateToken();

      const logoutResponse = await fetch(getTestServerURL('/auth/logout'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
          Authorization: `Bearer ${headerToken}`,
        },
        body: JSON.stringify({ token: bodyToken }),
      });
      expect(logoutResponse.status).toBe(200);

      const userInDb = await UserModel.findOne({
        email: 'logout-both@test.com',
      });
      expect(
        userInDb?.sessionTokens?.some((t) => t.token === hashToken(bodyToken)),
      ).toBeFalsy();
      expect(
        userInDb?.sessionTokens?.some(
          (t) => t.token === hashToken(headerToken),
        ),
      ).toBeTruthy();
    });

    it('can logout without token', async () => {
      expect.assertions(1);
      const response = await fetch(getTestServerURL('/auth/logout'), {
        method: 'POST',
      });
      expect(response.status).toBe(200);
    });
  });

  describe('rate limiter', () => {
    it('should receive 429 on rate limit exceeded', async () => {
      expect.assertions(1);

      const requests = Array.from({ length: 11 }, () =>
        fetch(getTestServerURL('/auth/logout'), {
          method: 'POST',
        }),
      );

      const responses = await Promise.all(requests);
      const statusCodes = responses.map((response) => response.status);

      expect(statusCodes).toContain(429);
    });
  });

  // Under concurrency both requests pass the check-then-create existence guard,
  // so the loser's `User.create` hits a unique index (E11000). That must map to
  // the SAME friendly 400s as the sequential path — not a generic 500 (finding
  // #9). Spying the existence check reproduces the race deterministically.
  describe('concurrent duplicate registration (finding #9)', () => {
    // E11000 only fires when the unique indexes actually exist; boot does not
    // build them in the test DB, so create them explicitly first.
    beforeAll(async () => {
      const UserModel = appInstance.getModel('User') as unknown as {
        syncIndexes: () => Promise<unknown>;
      };
      await UserModel.syncIndexes();
    });

    type SpyableUser = {
      create: (...args: unknown[]) => Promise<unknown>;
      findOne: (...args: unknown[]) => Promise<unknown>;
      getUserByEmail: (...args: unknown[]) => Promise<unknown>;
    };

    it('maps a raced duplicate-email create to 400, not 500', async () => {
      expect.assertions(2);
      const UserModel = appInstance.getModel('User') as unknown as TUser;
      const email = 'race-dup-email@test.com';
      await UserModel.create({ email, password: userPassword });

      // The existence check reports "free" though the row exists, so `create`
      // reaches the unique email index and throws E11000.
      const spy = vi
        .spyOn(UserModel as unknown as SpyableUser, 'getUserByEmail')
        .mockResolvedValue(null);
      try {
        const response = await fetch(getTestServerURL('/auth/register'), {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({ email, password: userPassword }),
        });
        const body = (await response.json()) as { message?: string };
        expect(response.status).toBe(400);
        expect(body.message).toBe('User with such an email already registered');
      } finally {
        spy.mockRestore();
      }
    });

    it('maps a raced duplicate-nick create to 400, not 500', async () => {
      expect.assertions(2);
      const UserModel = appInstance.getModel('User') as unknown as TUser;
      const nickName = 'raceDupNick';
      await UserModel.create({
        email: 'race-nick-owner@test.com',
        password: userPassword,
        name: { nick: nickName },
      });

      // `findOne` backs both existence checks; mocking it null lets a genuinely
      // new email through while the pre-existing nick still collides in `create`.
      const spy = vi
        .spyOn(UserModel as unknown as SpyableUser, 'findOne')
        .mockResolvedValue(null);
      try {
        const response = await fetch(getTestServerURL('/auth/register'), {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            email: 'race-nick-newcomer@test.com',
            password: userPassword,
            nickName,
          }),
        });
        const body = (await response.json()) as { message?: string };
        expect(response.status).toBe(400);
        expect(body.message).toBe('User with such nickname already exists');
      } finally {
        spy.mockRestore();
      }
    });

    it('does NOT swallow a duplicate on any other index (stays 500)', async () => {
      expect.assertions(1);
      const UserModel = appInstance.getModel('User') as unknown as TUser;
      // A future unique index (not email/nick) is not one of the register form's
      // known conflicts, so its E11000 must propagate to the generic 500 — never
      // be reported as a client-facing 400.
      const foreignDup = Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
        keyPattern: { tenantId: 1 },
        keyValue: { tenantId: 'acme' },
      });
      const emailSpy = vi
        .spyOn(UserModel as unknown as SpyableUser, 'getUserByEmail')
        .mockResolvedValue(null);
      const createSpy = vi
        .spyOn(UserModel as unknown as SpyableUser, 'create')
        .mockRejectedValue(foreignDup);
      try {
        const response = await fetch(getTestServerURL('/auth/register'), {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            email: 'race-foreign@test.com',
            password: userPassword,
          }),
        });
        expect(response.status).toBe(500);
      } finally {
        emailSpy.mockRestore();
        createSpy.mockRestore();
      }
    });
  });
});
