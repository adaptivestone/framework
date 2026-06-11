import type { Response } from 'express';
import type { TUser } from '../models/User.ts';
import { hashToken } from '../models/User.ts';
import AbstractController from '../modules/AbstractController.ts';
import GetUserByToken from '../services/http/middleware/GetUserByToken.ts';
import RateLimiter from '../services/http/middleware/RateLimiter.ts';
import { defineSchema } from '../services/validate/defineSchema.ts';
import type { StandardSchemaV1 } from '../services/validate/types.ts';
import type {
  PostLoginRequest,
  PostLogoutRequest,
  PostRegisterRequest,
  RecoverPasswordRequest,
  SendPasswordRecoveryEmailRequest,
  SendVerificationRequest,
  VerifyUserRequest,
} from './Auth.routes.gen.ts';

type UserInstance = InstanceType<TUser>;

// Zero-dependency validation for the built-in auth routes. Messages are i18n
// keys (see `src/locales/*`); the framework auto-translates them via the
// request's `i18n.t` before the error is serialized.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PASSWORD_RE = /^[a-zA-Z0-9!@#$%ˆ^&*()_+\-{}[\]<>]+$/;
const NICK_RE = /^[a-zA-Z0-9_\-.]+$/;
const isMissing = (v: unknown) => v === undefined || v === null || v === '';
// Coerce primitives to string the way yup's `string()` did, so numeric/boolean
// JSON values keep validating (e.g. `password: 123` → `"123"`). `null`,
// `undefined`, and non-primitives (arrays/objects) pass through unchanged — yup
// did not stringify those either, so the type/required checks still fire.
const coerceStr = (v: unknown): unknown =>
  v == null || typeof v === 'object' ? v : String(v);

const pushEmailIssues = (email: unknown, issues: StandardSchemaV1.Issue[]) => {
  if (isMissing(email)) {
    issues.push({ message: 'auth.emailProvided', path: ['email'] });
  } else if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    issues.push({ message: 'auth.emailValid', path: ['email'] });
  }
};

class Auth extends AbstractController {
  get routes() {
    return {
      post: {
        '/login': {
          handler: this.postLogin,
          request: defineSchema<{ email: string; password: string }>(
            (value) => {
              const v = (value ?? {}) as Record<string, unknown>;
              const email = coerceStr(v.email);
              const password = coerceStr(v.password);
              const issues: StandardSchemaV1.Issue[] = [];
              pushEmailIssues(email, issues);
              if (isMissing(password) || typeof password !== 'string') {
                issues.push({
                  message: 'auth.passwordProvided',
                  path: ['password'],
                });
              }
              if (issues.length) {
                return { issues };
              }
              return {
                value: {
                  email: email as string,
                  password: password as string,
                },
              };
            },
          ),
        },
        '/register': {
          handler: this.postRegister,
          request: defineSchema<{
            email: string;
            password: string;
            nickName?: string;
            firstName?: string;
            lastName?: string;
          }>((value) => {
            const v = (value ?? {}) as Record<string, unknown>;
            const email = coerceStr(v.email);
            const password = coerceStr(v.password);
            const nickName = coerceStr(v.nickName);
            const firstName = coerceStr(v.firstName);
            const lastName = coerceStr(v.lastName);
            const issues: StandardSchemaV1.Issue[] = [];
            pushEmailIssues(email, issues);
            if (isMissing(password)) {
              issues.push({
                message: 'auth.passwordProvided',
                path: ['password'],
              });
            } else if (
              typeof password !== 'string' ||
              !PASSWORD_RE.test(password)
            ) {
              issues.push({
                message: 'auth.passwordValid',
                path: ['password'],
              });
            }
            // nickName is optional, but an empty string is invalid (matches the
            // old yup `.matches()` behavior — only `null`/`undefined` skip).
            if (
              nickName != null &&
              (typeof nickName !== 'string' || !NICK_RE.test(nickName))
            ) {
              issues.push({
                message: 'auth.nickNameValid',
                path: ['nickName'],
              });
            }
            // firstName/lastName are optional free-form strings, but a non-string
            // (array/object) would otherwise reach `User.create` and fail the
            // Mongoose String cast with a 500. Reject it as a 400 (yup parity).
            if (firstName != null && typeof firstName !== 'string') {
              issues.push({ message: 'auth.nameValid', path: ['firstName'] });
            }
            if (lastName != null && typeof lastName !== 'string') {
              issues.push({ message: 'auth.nameValid', path: ['lastName'] });
            }
            if (issues.length) {
              return { issues };
            }
            return {
              value: {
                email: email as string,
                password: password as string,
                nickName: nickName as string | undefined,
                firstName: firstName as string | undefined,
                lastName: lastName as string | undefined,
              },
            };
          }),
        },
        '/logout': this.postLogout,
        '/verify': this.verifyUser,
        '/send-recovery-email': {
          handler: this.sendPasswordRecoveryEmail,
          request: defineSchema<{ email: string }>((value) => {
            const v = (value ?? {}) as Record<string, unknown>;
            const email = coerceStr(v.email);
            const issues: StandardSchemaV1.Issue[] = [];
            pushEmailIssues(email, issues);
            if (issues.length) {
              return { issues };
            }
            return { value: { email: email as string } };
          }),
        },
        '/recover-password': {
          handler: this.recoverPassword,
          request: defineSchema<{
            password: string;
            passwordRecoveryToken: string;
          }>((value) => {
            const v = (value ?? {}) as Record<string, unknown>;
            const password = coerceStr(v.password);
            const passwordRecoveryToken = coerceStr(v.passwordRecoveryToken);
            const issues: StandardSchemaV1.Issue[] = [];
            if (isMissing(password)) {
              issues.push({
                message: 'auth.passwordProvided',
                path: ['password'],
              });
            } else if (
              typeof password !== 'string' ||
              !PASSWORD_RE.test(password)
            ) {
              issues.push({
                message: 'auth.passwordValid',
                path: ['password'],
              });
            }
            if (isMissing(passwordRecoveryToken)) {
              issues.push({
                message: 'auth.passwordRecoveryTokenProvided',
                path: ['passwordRecoveryToken'],
              });
            }
            if (issues.length) {
              return { issues };
            }
            return {
              value: {
                password: password as string,
                passwordRecoveryToken: passwordRecoveryToken as string,
              },
            };
          }),
        },
        '/send-verification': {
          handler: this.sendVerification,
          request: defineSchema<{ email: string }>((value) => {
            const v = (value ?? {}) as Record<string, unknown>;
            const email = coerceStr(v.email);
            const issues: StandardSchemaV1.Issue[] = [];
            pushEmailIssues(email, issues);
            if (issues.length) {
              return { issues };
            }
            return { value: { email: email as string } };
          }),
        },
      },
    };
  }

  async postLogin(req: PostLoginRequest, res: Response) {
    const User = this.app.getModel('User') as unknown as TUser;
    const userResult = await User.getUserByEmailAndPassword(
      req.appInfo.request.email, // we do a request casting
      req.appInfo.request.password, // we do a request casting
    );
    if (!userResult) {
      return res
        .status(400)
        .json({ message: req.appInfo.i18n?.t('auth.errorUPValid') });
    }
    // TypeScript now knows userResult is not false, so it has the instance methods
    const user = userResult;
    const { isAuthWithVefificationFlow } = this.app.getConfig('auth');
    if (isAuthWithVefificationFlow && !user.isVerified) {
      return res.status(400).json({
        message: req.appInfo.i18n?.t('email.notVerified'),
        notVerified: true,
      });
    }
    const token = await user.generateToken();

    return res.status(200).json({ data: { token, user: user.getPublic() } });
  }

  async postRegister(req: PostRegisterRequest, res: Response) {
    const User = req.appInfo.app.getModel('User') as unknown as TUser;
    let user = (await User.getUserByEmail(
      req.appInfo.request.email,
    )) as InstanceType<TUser>;
    if (user) {
      return res
        .status(400)
        .json({ message: req.appInfo.i18n?.t('email.registered') });
    }
    if (req.appInfo.request.nickName) {
      user = (await User.findOne({
        'name.nick': req.appInfo.request.nickName,
      })) as InstanceType<TUser>;
      if (user) {
        return res
          .status(400)
          .json({ message: req.appInfo.i18n?.t('auth.nicknameExists') });
      }
    }

    user = await User.create({
      email: req.appInfo.request.email,
      password: req.appInfo.request.password,
      name: {
        first: req.appInfo.request.firstName,
        last: req.appInfo.request.lastName,
        nick: req.appInfo.request.nickName,
      },
    });

    const { isAuthWithVefificationFlow } = this.app.getConfig('auth');
    if (isAuthWithVefificationFlow) {
      await (user as UserInstance)
        .sendVerificationEmail(req.appInfo.i18n)
        .catch((e: Error) => {
          this.logger?.error(e);
        });
    }
    return res.status(201).json();
  }

  async postLogout(req: PostLogoutRequest, res: Response) {
    const user = req.appInfo.user;
    if (user) {
      const rawToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (rawToken) {
        const UserModel = this.app.getModel('User') as unknown as TUser;
        // Tokens are stored hashed, so match by hash.
        await UserModel.updateOne(
          { _id: user._id },
          { $pull: { sessionTokens: { token: hashToken(rawToken) } } },
        );
      }
    }
    return res.status(200).json({ message: 'Ok' });
  }

  async verifyUser(req: VerifyUserRequest, res: Response) {
    const User = req.appInfo.app.getModel('User') as unknown as TUser;
    let user: UserInstance;
    try {
      user = (await User.getUserByVerificationToken(
        req.query.verification_token as string,
      )) as unknown as UserInstance;
    } catch {
      return res.status(400).json({
        message: req.appInfo.i18n?.t('email.alreadyVerifiedOrWrongToken'),
      });
    }
    this.logger?.debug(`Verify user ${user?.id}`);
    if (!user) {
      return res.status(400).json({
        message: req.appInfo.i18n?.t('email.alreadyVerifiedOrWrongToken'),
      });
    }

    user.isVerified = true;
    await user.save();
    return res.status(200).json();
  }

  async sendPasswordRecoveryEmail(
    req: SendPasswordRecoveryEmailRequest,
    res: Response,
  ) {
    const User = req.appInfo.app.getModel('User') as unknown as TUser;
    // Uniform response whether or not the account exists — the old 400-vs-200
    // split was an account-existence oracle. The dispatch is fire-and-forget so
    // the known-email path isn't slower (token gen + SMTP), which would be a
    // timing oracle; the response never depends on the send outcome.
    try {
      const user = await User.getUserByEmail(req.appInfo.request.email);
      if (user) {
        void (user as UserInstance)
          .sendPasswordRecoveryEmail(req.appInfo.i18n)
          .catch((e: Error) => this.logger?.error(e));
      }
    } catch (e) {
      this.logger?.error(e);
    }
    return res
      .status(200)
      .json({ message: req.appInfo.i18n?.t('auth.recoveryEmailSent') });
  }

  async recoverPassword(req: RecoverPasswordRequest, res: Response) {
    const User = this.app.getModel('User') as unknown as TUser;
    const user = await User.getUserByPasswordRecoveryToken(
      req.appInfo.request.passwordRecoveryToken,
    ).catch((e: Error) => {
      this.logger?.error(e);
    });

    if (!user) {
      return res
        .status(400)
        .json({ message: req.appInfo.i18n?.t('password.wrongToken') });
    }

    this.logger?.debug(`Password recovery user ${user.id}`);

    user.password = req.appInfo.request.password;
    user.isVerified = true;
    await user.save();
    return res.status(200).json();
  }

  async sendVerification(req: SendVerificationRequest, res: Response) {
    const User = this.app.getModel('User') as unknown as TUser;
    // Uniform response + fire-and-forget dispatch — no existence oracle and no
    // timing oracle (the known-email path doesn't block on token gen + SMTP).
    try {
      const user = await User.getUserByEmail(req.appInfo.request.email);
      if (user) {
        void (user as UserInstance)
          .sendVerificationEmail(req.appInfo.i18n)
          .catch((e: Error) => this.logger?.error(e));
      }
    } catch (e) {
      this.logger?.error(e);
    }
    return res
      .status(200)
      .json({ message: req.appInfo.i18n?.t('auth.verificationEmailSent') });
  }

  static get middleware() {
    return new Map([['/{*splat}', [GetUserByToken, RateLimiter]]]);
  }
}

export default Auth;
