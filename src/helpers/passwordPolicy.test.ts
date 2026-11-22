import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { object, string } from 'yup';
import type {
  RouteParams,
  TMiddleware,
} from '../modules/AbstractController.ts';
import AbstractController from '../modules/AbstractController.ts';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';
import { BadRequestError } from '../services/http/httpErrors.ts';
import { HttpResponse } from '../services/http/responses.ts';
import { testEach } from '../tests/parameterized.ts';
import { getTestServerURL } from '../tests/testHelpers.ts';
import { appInstance } from './appInstance.ts';
import { passwordPolicyIssues } from './passwordPolicy.ts';

// The shipped policy (15..128), restored after every test that changes it.
let originalPolicy: unknown;
const setPolicy = (passwordPolicy: unknown) =>
  appInstance.updateConfig('auth', { passwordPolicy });

beforeEach(() => {
  originalPolicy = appInstance.getConfig('auth').passwordPolicy;
});
afterEach(() => {
  setPolicy(originalPolicy);
});

describe('passwordPolicyIssues', () => {
  testEach<[unknown]>(
    [[undefined], [null], [''], [123], [['a'.repeat(20)]], [{}]],
    'asks for a password when given %o',
    (password) => {
      assert.deepStrictEqual(passwordPolicyIssues(password), [
        {
          message: 'auth.passwordProvided',
          path: ['password'],
          params: { defaultValue: 'Password must be provided' },
        },
      ]);
    },
  );

  it('reports a too short password with the policy bounds', () => {
    assert.deepStrictEqual(passwordPolicyIssues('a'.repeat(14)), [
      {
        message: 'auth.passwordTooShort',
        path: ['password'],
        params: {
          min: 15,
          max: 128,
          defaultValue: 'Password must be at least 15 characters',
        },
      },
    ]);
  });

  it('reports a too long password with the policy bounds', () => {
    assert.deepStrictEqual(passwordPolicyIssues('a'.repeat(129)), [
      {
        message: 'auth.passwordTooLong',
        path: ['password'],
        params: {
          min: 15,
          max: 128,
          defaultValue: 'Password must be at most 128 characters',
        },
      },
    ]);
  });

  testEach(
    [
      ['a'.repeat(15)],
      ['a'.repeat(128)],
      ['a long passphrase with spaces'],
      ['😀'.repeat(15)],
      ['😀'.repeat(128)],
    ],
    'accepts a password within the policy %#',
    (password) => {
      assert.deepStrictEqual(passwordPolicyIssues(password), []);
    },
  );

  it('counts code points, not UTF-16 units', () => {
    assert.deepStrictEqual(
      passwordPolicyIssues('😀'.repeat(14)).map((issue) => issue.message),
      ['auth.passwordTooShort'],
    );
    assert.deepStrictEqual(
      passwordPolicyIssues('😀'.repeat(129)).map((issue) => issue.message),
      ['auth.passwordTooLong'],
    );
  });

  it('reports under the given field', () => {
    assert.deepStrictEqual(
      [
        ...passwordPolicyIssues(undefined, 'newPassword'),
        ...passwordPolicyIssues('short', 'newPassword'),
      ].map((issue) => [issue.message, issue.path]),
      [
        ['auth.passwordProvided', ['newPassword']],
        ['auth.passwordTooShort', ['newPassword']],
      ],
    );
  });

  it('reads the policy from the app config', () => {
    setPolicy({ minLength: 8, maxLength: 20 });
    assert.deepStrictEqual(passwordPolicyIssues('12345678'), []);
    assert.deepStrictEqual(passwordPolicyIssues('1234567'), [
      {
        message: 'auth.passwordTooShort',
        path: ['password'],
        params: {
          min: 8,
          max: 20,
          defaultValue: 'Password must be at least 8 characters',
        },
      },
    ]);
  });

  testEach(
    [
      [{ minLength: 0 }],
      [{ minLength: 1.5 }],
      [{ minLength: 20, maxLength: 10 }],
      [{ maxLength: '200' }],
    ],
    'throws on an invalid policy %o',
    (policy) => {
      setPolicy(policy);
      assert.throws(() => passwordPolicyIssues('a'.repeat(30)), {
        message:
          'Invalid auth.passwordPolicy: require 1 <= minLength <= maxLength',
      });
    },
  );
});

/** A password change route written the way the helper's docs show. */
class PasswordPolicyRoutes extends AbstractController {
  get routes(): RouteParams {
    return {
      post: {
        '/change': {
          handler: this.postChange,
          request: object({ newPassword: string() }),
        },
      },
    };
  }

  async postChange(req: FrameworkRequest) {
    const issues = passwordPolicyIssues(
      req.appInfo.request.newPassword,
      'newPassword',
    );
    if (issues.length) {
      throw new BadRequestError({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        errors: issues,
      });
    }
    return HttpResponse.json(200, { changed: true });
  }

  static get middleware(): Map<string, TMiddleware> {
    return new Map();
  }
}

describe('passwordPolicyIssues thrown in a BadRequestError over HTTP', () => {
  before(() => {
    appInstance.controllerManager?.registerController(
      PasswordPolicyRoutes,
      'test',
    );
  });

  const post = (newPassword: string, lang?: string) =>
    fetch(getTestServerURL('/test/passwordpolicyroutes/change'), {
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        ...(lang ? { 'X-Lang': lang } : {}),
      },
      body: JSON.stringify({ newPassword }),
    });

  const errorsOf = async (res: Response) => {
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'VALIDATION_FAILED');
    assert.strictEqual(body.message, 'Validation failed');
    return body.errors;
  };

  it('answers 200 for a password within the policy', async () => {
    const res = await post('a long passphrase with spaces');
    assert.strictEqual(res.status, 200);
  });

  it('answers 400 with the English texts, bounds interpolated', async () => {
    assert.deepStrictEqual(await errorsOf(await post('short')), {
      newPassword: ['Password must be at least 15 characters'],
    });
    assert.deepStrictEqual(await errorsOf(await post('a'.repeat(129))), {
      newPassword: ['Password must be at most 128 characters'],
    });
  });

  it('answers 400 in the request language, bounds interpolated', async () => {
    assert.deepStrictEqual(await errorsOf(await post('short', 'ru')), {
      newPassword: ['Пароль должен быть не менее 15 символов'],
    });
    assert.deepStrictEqual(await errorsOf(await post('a'.repeat(129), 'ru')), {
      newPassword: ['Пароль должен быть не более 128 символов'],
    });
  });

  it('interpolates the configured bounds, not the shipped ones', async () => {
    setPolicy({ minLength: 8, maxLength: 20 });
    assert.deepStrictEqual(await errorsOf(await post('short')), {
      newPassword: ['Password must be at least 8 characters'],
    });
    assert.deepStrictEqual(await errorsOf(await post('a'.repeat(21), 'ru')), {
      newPassword: ['Пароль должен быть не более 20 символов'],
    });
  });
});
