import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import type { Response } from 'express';
import Transport from 'winston-transport';
import { appInstance } from '../helpers/appInstance.ts';
import type { TUser } from '../models/User.ts';
import { hashToken, userHelpers } from '../models/User.ts';
import type { IApp } from '../server.ts';
import {
  assertCalledTimes,
  assertCalledWith,
  assertNotCalled,
  assertRejectsValue,
  pattern,
} from '../tests/assertions.ts';
import {
  mockImplementation,
  mockRejectedValue,
  mockResolvedValue,
} from '../tests/mocks.ts';
import { testEach } from '../tests/parameterized.ts';
import { getTestServerURL } from '../tests/testHelpers.ts';
import Auth from './Auth.ts';

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

describe('auth route schemas', () => {
  const routes = new Auth(appInstance, '').routes.post;
  const validate = async (path: string, value: unknown) => {
    const route = routes[path];
    if (
      typeof route === 'function' ||
      !route?.request ||
      !('~standard' in route.request)
    ) {
      throw new Error(`No Standard Schema request validator for ${path}`);
    }
    return route.request['~standard'].validate(value);
  };

  testEach(
    [
      [{}, ['auth.emailProvided', 'auth.passwordProvided']],
      [
        { email: 'valid@example.com', password: 'contains a space' },
        ['auth.passwordValid'],
      ],
      [
        { email: 'valid@example.com', password: 'valid123', nickName: '' },
        ['auth.nickNameValid'],
      ],
      [
        {
          email: 'valid@example.com',
          password: 'valid123',
          firstName: {},
          lastName: [],
        },
        ['auth.nameValid', 'auth.nameValid'],
      ],
    ],
    'validates registration input %#',
    async (input, expectedMessages) => {
      const result = await validate('/register', input);
      assert.deepStrictEqual(
        'issues' in result ? result.issues?.map((issue) => issue.message) : [],
        expectedMessages,
      );
    },
  );

  testEach(
    [
      [{}, ['auth.passwordProvided', 'auth.passwordRecoveryTokenProvided']],
      [
        { password: 'contains a space', passwordRecoveryToken: 'token' },
        ['auth.passwordValid'],
      ],
    ],
    'validates password recovery input %#',
    async (input, expectedMessages) => {
      const result = await validate('/recover-password', input);
      assert.deepStrictEqual(
        'issues' in result ? result.issues?.map((issue) => issue.message) : [],
        expectedMessages,
      );
    },
  );

  testEach(
    ['/send-recovery-email', '/send-verification'],
    'requires an email for %s',
    async (path) => {
      const result = await validate(path, {});
      assert.deepStrictEqual(
        'issues' in result ? result.issues?.map((issue) => issue.message) : [],
        ['auth.emailProvided'],
      );
    },
  );
});

describe('auth controller failure paths', () => {
  const response = () => {
    const state: { status?: number; body?: unknown } = {};
    const res = {
      status: mock.fn((status: number) => {
        state.status = status;
        return res;
      }),
      json: mock.fn((body?: unknown) => {
        state.body = body;
        return res;
      }),
    };
    return { res: res as unknown as Response, state };
  };

  const fakeApp = (
    User: Record<string, unknown>,
    authConfig: Record<string, unknown> = {},
    error = mock.fn(),
  ) =>
    ({
      getModel: () => User,
      getConfig: () => authConfig,
      logger: { child: () => ({ error, debug: mock.fn() }) },
    }) as unknown as IApp;

  const request = (app: IApp, values: Record<string, unknown>) =>
    ({
      appInfo: {
        app,
        request: values,
        i18n: { t: (key: string) => key },
      },
      query: {},
    }) as never;

  it('honors the legacy verification-flow key and warns only once', async () => {
    const sendVerificationEmail = mockResolvedValue(mock.fn(), undefined);
    const User = {
      getUserByEmail: mockResolvedValue(mock.fn(), null),
      create: mockResolvedValue(mock.fn(), { sendVerificationEmail }),
    };
    const app = fakeApp(User, { isAuthWithVefificationFlow: false });
    const auth = new Auth(app, '');
    const emitWarning = mockImplementation(
      mock.method(process, 'emitWarning'),
      () => {},
    );
    try {
      for (const email of [
        'legacy-one@example.com',
        'legacy-two@example.com',
      ]) {
        const { res, state } = response();
        await auth.postRegister(
          request(app, { email, password: 'valid123' }),
          res,
        );
        assert.strictEqual(state.status, 201);
      }

      assertCalledTimes(emitWarning, 1);
      assertCalledWith(
        emitWarning,
        pattern.stringContaining('isAuthWithVefificationFlow'),
        pattern.objectContaining({ code: 'ASF_DEP_AUTH_VERIFICATION_KEY' }),
      );
      assertNotCalled(sendVerificationEmail);
    } finally {
      emitWarning.mock.restore();
    }
  });

  it('logs a registration verification-email failure and still returns 201', async () => {
    const error = mock.fn();
    const User = {
      getUserByEmail: mockResolvedValue(mock.fn(), null),
      create: mockResolvedValue(mock.fn(), {
        sendVerificationEmail: mockRejectedValue(
          mock.fn(),
          new Error('verification mail down'),
        ),
      }),
    };
    const app = fakeApp(User, {}, error);
    const auth = new Auth(app, '');
    const { res, state } = response();

    await auth.postRegister(
      request(app, {
        email: 'mail-failure@example.com',
        password: 'valid123',
      }),
      res,
    );

    assert.strictEqual(state.status, 201);
    assertCalledWith(
      error,
      pattern.objectContaining({ message: 'verification mail down' }),
    );
  });

  it('rethrows a non-object user-create failure unchanged', async () => {
    const User = {
      getUserByEmail: mockResolvedValue(mock.fn(), null),
      create: mockRejectedValue(mock.fn(), 'primitive failure'),
    };
    const app = fakeApp(User);
    const auth = new Auth(app, '');

    await assertRejectsValue(
      auth.postRegister(
        request(app, {
          email: 'primitive-failure@example.com',
          password: 'valid123',
        }),
        response().res,
      ),
      'primitive failure',
    );
  });

  it('keeps recovery and verification lookup failures on uniform 200 responses', async () => {
    const error = mock.fn();
    const User = {
      getUserByEmail: mockRejectedValue(mock.fn(), new Error('database down')),
    };
    const app = fakeApp(User, {}, error);
    const auth = new Auth(app, '');

    const recovery = response();
    await auth.sendPasswordRecoveryEmail(
      request(app, { email: 'x@example.com' }),
      recovery.res,
    );
    const verification = response();
    await auth.sendVerification(
      request(app, { email: 'x@example.com' }),
      verification.res,
    );

    assert.strictEqual(recovery.state.status, 200);
    assert.strictEqual(verification.state.status, 200);
    assertCalledTimes(error, 2);
  });

  it('logs asynchronous mail failures after returning uniform responses', async () => {
    const error = mock.fn();
    const user = {
      sendPasswordRecoveryEmail: mockRejectedValue(
        mock.fn(),
        new Error('recovery mail down'),
      ),
      sendVerificationEmail: mockRejectedValue(
        mock.fn(),
        new Error('verification mail down'),
      ),
    };
    const User = { getUserByEmail: mockResolvedValue(mock.fn(), user) };
    const app = fakeApp(User, {}, error);
    const auth = new Auth(app, '');

    await auth.sendPasswordRecoveryEmail(
      request(app, { email: 'x@example.com' }),
      response().res,
    );
    await auth.sendVerification(
      request(app, { email: 'x@example.com' }),
      response().res,
    );
    await Promise.resolve();

    assertCalledTimes(error, 2);
  });

  it('returns 400 when verification lookup resolves without a user', async () => {
    const User = {
      getUserByVerificationToken: mockResolvedValue(mock.fn(), null),
    };
    const app = fakeApp(User);
    const auth = new Auth(app, '');
    const { res, state } = response();

    await auth.verifyUser(request(app, {}), res);

    assert.strictEqual(state.status, 400);
    assert.deepStrictEqual(state.body, {
      message: 'email.alreadyVerifiedOrWrongToken',
    });
  });
});

describe('auth', () => {
  describe('registration', () => {
    it('code NOT able to create user with wrong email', async () => {
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

      assert.strictEqual(status, 400);
    });

    it('translates i18n keys in validation error response', async () => {
      const response = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.strictEqual(response.status, 400);

      const body = (await response.json()) as {
        errors: Record<string, string | string[]>;
      };
      // Schema declares messages as i18n keys (`auth.emailProvided`,
      // `auth.passwordProvided`); framework auto-translates via the
      // request's i18n.t before sending the response.
      assert.deepStrictEqual(body.errors.email, ['Email must be provided']);
      assert.deepStrictEqual(body.errors.password, [
        'Password must be provided',
      ]);
    });

    it('can create user', async () => {
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

      assert.strictEqual(status, 201);
    });

    it('can  not create user with the same nickname', async () => {
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

      assert.strictEqual(status, 400);
    });

    it('can NOT create SAME user', async () => {
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

      assert.strictEqual(status, 400);
    });
  });

  describe('login', () => {
    it('can NOT login with normal creds and not verified email', async () => {
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

      assert.strictEqual(status, 400);
    });

    it('can NOT login with WRONG creds', async () => {
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

      assert.strictEqual(status, 400);
    });

    it('rejects a non-string password with 400 (not 500)', async () => {
      const { status } = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', password: ['x'] }),
      }).catch(() => ({ status: 500 }));

      assert.strictEqual(status, 400);
    });

    it('can login with normal creds and verified email', async () => {
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

      assert.strictEqual(response.status, 200);
      assert.notStrictEqual(responseBody.data, undefined);
      assert.notStrictEqual(responseBody.data.token, undefined);
    });
  });

  describe('isAuthWithVerificationFlow auth option', () => {
    it('can verify user', async () => {
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

      assert.strictEqual(status, 200);
      assert.ok(isVerified);
    });

    it('can not verify user with wrong token', async () => {
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

      assert.strictEqual(status, 400);
      assert.ok(!isVerified);
    });

    it('send-recovery-email is identical for known and unknown emails (no enumeration, doc 19)', async () => {
      const post = (email: string) =>
        fetch(getTestServerURL('/auth/send-recovery-email'), {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });

      const known = await post(userEmail);
      const unknown = await post('notExists@gmail.com');

      assert.strictEqual(unknown.status, known.status);
      assert.strictEqual(await unknown.text(), await known.text());
    });

    it('can send recovery to exist email', async () => {
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

      assert.strictEqual(status, 200);
    });

    it('send-recovery-email still creates a recovery token for a known user (doc 19)', async () => {
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
      assert.ok(count > 0);
    });

    it('does not log the password hash during recovery (doc 20)', async () => {
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
      assert.ok(!all.includes(hash));
      assert.ok(!all.includes(token));
    });

    it('can recover password', async () => {
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

      assert.strictEqual(status, 200);
    });

    it('can not recover password with wrong token', async () => {
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

      assert.strictEqual(status, 400);
    });

    it('can login with normal creds and NOT verifyed email if option isAuthWithVerificationFlow is set', async () => {
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

      assert.strictEqual(status, 201);
      assert.strictEqual(status2, 400);
      assert.strictEqual(response3.status, 200);
      assert.notStrictEqual(responseBody3.data.token, undefined);
    });
  });

  it('can user send verification', async () => {
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

    assert.strictEqual(status, 200);
  });

  it('send-verification is identical for known and unknown emails (no enumeration, doc 19)', async () => {
    const post = (email: string) =>
      fetch(getTestServerURL('/auth/send-verification'), {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });

    const known = await post(userEmail2);
    const unknown = await post('wrong@gmail.com');

    assert.strictEqual(unknown.status, known.status);
    assert.strictEqual(await unknown.text(), await known.text());
  });

  describe('logout', () => {
    it('can logout', async () => {
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
      assert.ok(hasToken);

      // 4. Logout
      const logoutResponse = await fetch(getTestServerURL('/auth/logout'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      assert.strictEqual(logoutResponse.status, 200);

      // 5. Verify token removed
      userInDb = await UserModel.findOne({ email: 'logout@test.com' });
      const hasTokenAfter = userInDb?.sessionTokens?.some(
        (t) => t.token === hashToken(token),
      );
      assert.ok(!hasTokenAfter);
    });

    it('can logout with token in the body', async () => {
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
      assert.ok(hasToken);

      const logoutResponse = await fetch(getTestServerURL('/auth/logout'), {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      assert.strictEqual(logoutResponse.status, 200);

      userInDb = await UserModel.findOne({ email: 'logout-body@test.com' });
      const hasTokenAfter = userInDb?.sessionTokens?.some(
        (t) => t.token === hashToken(token),
      );
      assert.ok(!hasTokenAfter);
    });

    it('revokes the body (authenticated) token when both body and header tokens are present', async () => {
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
      assert.strictEqual(logoutResponse.status, 200);

      const userInDb = await UserModel.findOne({
        email: 'logout-both@test.com',
      });
      assert.ok(
        !userInDb?.sessionTokens?.some((t) => t.token === hashToken(bodyToken)),
      );
      assert.ok(
        userInDb?.sessionTokens?.some(
          (t) => t.token === hashToken(headerToken),
        ),
      );
    });

    it('can logout without token', async () => {
      const response = await fetch(getTestServerURL('/auth/logout'), {
        method: 'POST',
      });
      assert.strictEqual(response.status, 200);
    });
  });

  describe('rate limiter', () => {
    it('should receive 429 on rate limit exceeded', async () => {
      const requests = Array.from({ length: 11 }, () =>
        fetch(getTestServerURL('/auth/logout'), {
          method: 'POST',
        }),
      );

      const responses = await Promise.all(requests);
      const statusCodes = responses.map((response) => response.status);

      assert.ok(statusCodes.includes(429));
    });
  });

  // Under concurrency both requests pass the check-then-create existence guard,
  // so the loser's `User.create` hits a unique index (E11000). That must map to
  // the SAME friendly 400s as the sequential path — not a generic 500 (finding
  // #9). Spying the existence check reproduces the race deterministically.
  describe('concurrent duplicate registration (finding #9)', () => {
    // E11000 only fires when the unique indexes actually exist; boot does not
    // build them in the test DB, so create them explicitly first.
    before(async () => {
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
      const UserModel = appInstance.getModel('User') as unknown as TUser;
      const email = 'race-dup-email@test.com';
      await UserModel.create({ email, password: userPassword });

      // The existence check reports "free" though the row exists, so `create`
      // reaches the unique email index and throws E11000.
      const spy = mockResolvedValue(
        mock.method(UserModel as unknown as SpyableUser, 'getUserByEmail'),
        null,
      );
      try {
        const response = await fetch(getTestServerURL('/auth/register'), {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({ email, password: userPassword }),
        });
        const body = (await response.json()) as { message?: string };
        assert.strictEqual(response.status, 400);
        assert.strictEqual(
          body.message,
          'User with such an email already registered',
        );
      } finally {
        spy.mock.restore();
      }
    });

    it('maps a raced duplicate-nick create to 400, not 500', async () => {
      const UserModel = appInstance.getModel('User') as unknown as TUser;
      const nickName = 'raceDupNick';
      await UserModel.create({
        email: 'race-nick-owner@test.com',
        password: userPassword,
        name: { nick: nickName },
      });

      // `findOne` backs both existence checks; mocking it null lets a genuinely
      // new email through while the pre-existing nick still collides in `create`.
      const spy = mockResolvedValue(
        mock.method(UserModel as unknown as SpyableUser, 'findOne'),
        null,
      );
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
        assert.strictEqual(response.status, 400);
        assert.strictEqual(
          body.message,
          'User with such nickname already exists',
        );
      } finally {
        spy.mock.restore();
      }
    });

    it('does NOT swallow a duplicate on any other index (stays 500)', async () => {
      const UserModel = appInstance.getModel('User') as unknown as TUser;
      // A future unique index (not email/nick) is not one of the register form's
      // known conflicts, so its E11000 must propagate to the generic 500 — never
      // be reported as a client-facing 400.
      const foreignDup = Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
        keyPattern: { tenantId: 1 },
        keyValue: { tenantId: 'acme' },
      });
      const emailSpy = mockResolvedValue(
        mock.method(UserModel as unknown as SpyableUser, 'getUserByEmail'),
        null,
      );
      const createSpy = mockRejectedValue(
        mock.method(UserModel as unknown as SpyableUser, 'create'),
        foreignDup,
      );
      try {
        const response = await fetch(getTestServerURL('/auth/register'), {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            email: 'race-foreign@test.com',
            password: userPassword,
          }),
        });
        assert.strictEqual(response.status, 500);
      } finally {
        emailSpy.mock.restore();
        createSpy.mock.restore();
      }
    });
  });
});
