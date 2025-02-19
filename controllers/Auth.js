import { object, string } from 'yup';
import AbstractController from '../modules/AbstractController.js';
import GetUserByToken from '../services/http/middleware/GetUserByToken.js';
import RateLimiter from '../services/http/middleware/RateLimiter.js';

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

  async postLogin(req, res) {
    const User = this.app.getModel('User');
    const user = await User.getUserByEmailAndPassword(
      req.appInfo.request.email, // we do a request casting
      req.appInfo.request.password, // we do a request casting
    );
    if (!user) {
      return res.status(400).json({ message: req.i18n.t('auth.errorUPValid') });
    }
    const { isAuthWithVefificationFlow } = this.app.getConfig('auth');
    if (isAuthWithVefificationFlow && !user.isVerified) {
      return res
        .status(400)
        .json({ message: req.i18n.t('email.notVerified'), notVerified: true });
    }
    const token = await user.generateToken();

    return res.status(200).json({ data: { token, user: user.getPublic() } });
  }

  async postRegister(req, res) {
    const User = req.appInfo.app.getModel('User');
    let user = await User.getUserByEmail(req.appInfo.request.email);
    if (user) {
      return res.status(400).json({ message: req.i18n.t('email.registered') });
    }
    if (req.appInfo.request.nickName) {
      user = await User.findOne({ 'name.nick': req.appInfo.request.nickName });
      if (user) {
        return res
          .status(400)
          .json({ message: req.i18n.t('auth.nicknameExists') });
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
      await user.sendVerificationEmail(req.i18n).catch((e) => {
        this.logger.error(e);
      });
    }
    return res.status(201).json();
  }

  // eslint-disable-next-line class-methods-use-this
  async postLogout(req, res) {
    // todo remove token
    return res.status(200).json();
  }

  async verifyUser(req, res) {
    const User = req.appInfo.app.getModel('User');
    let user;
    try {
      user = await User.getUserByVerificationToken(
        req.query.verification_token,
      );
    } catch {
      return res.status(400).json({
        message: req.i18n.t('email.alreadyVerifiedOrWrongToken'),
      });
    }
    this.logger.debug(`Verify user user is :${user}`);
    if (!user) {
      return res.status(400).json({
        message: req.i18n.t('email.alreadyVerifiedOrWrongToken'),
      });
    }

    user.isVerified = true;
    await user.save();
    return res.status(200).json();
  }

  async sendPasswordRecoveryEmail(req, res) {
    const User = req.appInfo.app.getModel('User');
    try {
      const user = await User.getUserByEmail(req.appInfo.request.email);
      if (!user) {
        return res
          .status(400)
          .json({ message: req.i18n.t('auth.errorUExist') });
      }
      await user.sendPasswordRecoveryEmail(req.i18n);
      return res.status(200).json();
    } catch (e) {
      this.logger.error(e);
      return res.status(400).json({ message: req.i18n.t('auth.errorUExist') });
    }
  }

  async recoverPassword(req, res) {
    const User = this.app.getModel('User');
    const user = await User.getUserByPasswordRecoveryToken(
      req.appInfo.request.passwordRecoveryToken,
    ).catch((e) => {
      this.logger.error(e);
    });

    if (!user) {
      return res
        .status(400)
        .json({ message: req.i18n.t('password.wrongToken') });
    }

    this.logger.debug(`Password recovery user is :${user}`);

    user.password = req.appInfo.request.password;
    user.isVerified = true;
    await user.save();
    return res.status(200).json();
  }

  async sendVerification(req, res) {
    const User = this.app.getModel('User');
    const user = await User.getUserByEmail(req.appInfo.request.email);
    if (!user) {
      return res.status(400).json({ message: req.i18n.t('auth.errorUExist') });
    }
    await user.sendVerificationEmail(req.i18n);
    return res.status(200).json();
  }

  static get middleware() {
    return new Map([['/{*splat}', [GetUserByToken, RateLimiter]]]);
  }
}

export default Auth;
