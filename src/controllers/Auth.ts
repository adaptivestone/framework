import type { Response } from 'express';
import type { TFunction } from 'i18next';
import { object, string } from 'yup';
import type { TUser } from '../models/User.ts';
import AbstractController from '../modules/AbstractController.ts';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';
import GetUserByToken from '../services/http/middleware/GetUserByToken.ts';
import RateLimiter from '../services/http/middleware/RateLimiter.ts';

type UserInstance = InstanceType<TUser>;

class Auth extends AbstractController {
  get routes() {
    return {
      post: {
        '/login': {
          handler: this.postLogin,
          request: object().shape({
            email: string().email().required('auth.emailProvided'), // if not provided then error will be generated
            password: string().required('auth.passwordProvided'), // possible to provide values from translation
          }),
        },
        '/register': {
          handler: this.postRegister,
          request: object().shape({
            email: string()
              .email('auth.emailValid')
              .required('auth.emailProvided'),
            password: string()
              .matches(
                /^[a-zA-Z0-9!@#$%ˆ^&*()_+\-{}[\]<>]+$/,
                'auth.passwordValid',
              )
              .required('auth.passwordProvided'),
            nickName: string().matches(
              /^[a-zA-Z0-9_\-.]+$/,
              'auth.nickNameValid',
            ),
            firstName: string(),
            lastName: string(),
          }),
        },
        '/logout': this.postLogout,
        '/verify': this.verifyUser,
        '/send-recovery-email': {
          handler: this.sendPasswordRecoveryEmail,
          request: object().shape({ email: string().email().required() }),
        },
        '/recover-password': {
          handler: this.recoverPassword,
          request: object().shape({
            password: string()
              .matches(
                /^[a-zA-Z0-9!@#$%ˆ^&*()_+\-{}[\]<>]+$/,
                'auth.passwordValid',
              )
              .required(),
            passwordRecoveryToken: string().required(),
          }),
        },
        '/send-verification': {
          handler: this.sendVerification,
          request: object().shape({ email: string().email().required() }),
        },
      },
    };
  }

  async postLogin(
    req: FrameworkRequest & {
      appInfo: {
        request: {
          email: string;
          password: string;
        };
      };
    },
    res: Response,
  ) {
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

  async postRegister(
    req: FrameworkRequest & {
      appInfo: {
        request: {
          email: string;
          password: string;
          firstName?: string;
          lastName?: string;
          nickName?: string;
        };
        i18n: {
          t: TFunction;
          language: string;
        };
      };
    },
    res: Response,
  ) {
    const User = req.appInfo.app.getModel('User') as unknown as TUser;
    let user = (await User.getUserByEmail(
      req.appInfo.request.email as string,
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

  async postLogout(_req: FrameworkRequest, res: Response) {
    // todo remove token
    return res.status(200).json();
  }

  async verifyUser(req: FrameworkRequest, res: Response) {
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
    this.logger?.debug(`Verify user user is :${user}`);
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
    req: FrameworkRequest & {
      appInfo: {
        request: {
          email: string;
        };
        i18n: {
          t: TFunction;
          language: string;
        };
      };
    },
    res: Response,
  ) {
    const User = req.appInfo.app.getModel('User') as unknown as TUser;
    try {
      const user = await User.getUserByEmail(
        req.appInfo.request.email as string,
      );
      if (!user) {
        return res
          .status(400)
          .json({ message: req.appInfo.i18n?.t('auth.errorUExist') });
      }
      await (user as UserInstance).sendPasswordRecoveryEmail(req.appInfo.i18n);
      return res.status(200).json();
    } catch (e) {
      this.logger?.error(e);
      return res
        .status(400)
        .json({ message: req.appInfo.i18n?.t('auth.errorUExist') });
    }
  }

  async recoverPassword(
    req: FrameworkRequest & {
      appInfo: {
        request: {
          passwordRecoveryToken: string;
          password: string;
        };
      };
    },
    res: Response,
  ) {
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

    this.logger?.debug(`Password recovery user is :${user}`);

    user.password = req.appInfo.request.password;
    user.isVerified = true;
    await user.save();
    return res.status(200).json();
  }

  async sendVerification(
    req: FrameworkRequest & {
      appInfo: {
        request: {
          email: string;
        };
        i18n: {
          t: TFunction;
          language: string;
        };
      };
    },
    res: Response,
  ) {
    const User = this.app.getModel('User') as unknown as TUser;
    const user = await User.getUserByEmail(req.appInfo.request.email);
    if (!user) {
      return res
        .status(400)
        .json({ message: req.appInfo.i18n?.t('auth.errorUExist') });
    }
    await (user as UserInstance).sendVerificationEmail(req.appInfo.i18n);
    return res.status(200).json();
  }

  static get middleware() {
    return new Map([['/{*splat}', [GetUserByToken, RateLimiter]]]);
  }
}

export default Auth;
