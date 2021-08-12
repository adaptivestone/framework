const yup = require('yup');
const AbstractController = require('../modules/AbstractController');
const PrepareAppInfo = require('../services/http/middleware/PrepareAppInfo');
const GetUserByToken = require('../services/http/middleware/GetUserByToken');
const RateLimiter = require('../services/http/middleware/RateLimiter');

class Auth extends AbstractController {
  get routes() {
    return {
      post: {
        '/login': {
          handler: this.postLogin,
          request: yup.object().shape({
            email: yup.string().email().required('auth.emailProvided'), // if not provided then error will be generated
            password: yup.string().required('auth.passwordProvided'), // possible to provide values from translation
          }),
        },
        '/register': {
          handler: this.postRegister,
          request: yup.object().shape({
            email: yup
              .string()
              .email('auth.emailValid')
              .required('auth.emailProvided'),
            password: yup
              .string()
              .matches(
                /^[a-zA-Z0-9!@#$%ˆ^&*()_+\-{}[\]<>]+$/,
                'auth.passwordValid',
              )
              .required('auth.passwordProvided'),
            nickName: yup
              .string()
              .matches(/^[a-zA-Z0-9_\-.]+$/, 'auth.nickNameValid'),
            firstName: yup.string(),
            lastName: yup.string(),
          }),
        },
        '/logout': this.postLogout,
        '/verify': this.verifyUser,
        '/send-recovery-email': {
          handler: this.sendPasswordRecoveryEmail,
          request: yup
            .object()
            .shape({ email: yup.string().email().required() }),
        },
        '/recover-password': {
          handler: this.recoverPassword,
          request: yup.object().shape({
            password: yup
              .string()
              .matches(
                /^[a-zA-Z0-9!@#$%ˆ^&*()_+\-{}[\]<>]+$/,
                'auth.passwordValid',
              )
              .required(),
            passwordRecoveryToken: yup.string().required(),
          }),
        },
        '/send-verification': {
          handler: this.sendVerification,
          request: yup
            .object()
            .shape({ email: yup.string().email().required() }),
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
      return res.status(400).json({ error: req.i18n.t('auth.errorUPValid') });
    }
    const { isAuthWithVefificationFlow } = this.app.getConfig('Auth');
    if (isAuthWithVefificationFlow && !user.isVerified) {
      return res
        .status(400)
        .json({ error: req.i18n.t('email.notVerified'), notVerified: true });
    }
    const token = await user.generateToken();

    return res
      .status(200)
      .json({ success: true, token, user: user.getPublic() });
  }

  async postRegister(req, res) {
    const User = req.appInfo.app.getModel('User');
    let user = await User.getUserByEmail(req.appInfo.request.email);
    if (user) {
      return res.status(400).json({ error: req.i18n.t('email.registered') });
    }
    if (req.appInfo.request.nickName) {
      user = await User.findOne({ 'name.nick': req.appInfo.request.nickName });
      if (user) {
        return res
          .status(400)
          .json({ error: req.i18n.t('auth.nicknameExists') });
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

    const { isAuthWithVefificationFlow } = this.app.getConfig('Auth');
    if (isAuthWithVefificationFlow) {
      const answer = await user.sendVerificationEmail(req.i18n).catch((e) => {
        this.logger.error(e.message);
      });
      if (!answer) {
        return res.status(500).json({ success: false });
      }
    }
    return res.status(201).json({ success: true });
  }

  // eslint-disable-next-line class-methods-use-this
  async postLogout(req, res) {
    // todo remove token
    return res.status(200).json({ success: true });
  }

  async verifyUser(req, res) {
    const User = req.appInfo.app.getModel('User');
    let user;
    try {
      user = await User.getUserByVerificationToken(
        req.query.verification_token,
      );
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: req.i18n.t('email.alreadyVerifiedOrWrongToken'),
      });
    }
    this.logger.debug(`Verify user user is :${user}`);
    if (!user) {
      return res.status(400).json({
        success: false,
        error: req.i18n.t('email.alreadyVerifiedOrWrongToken'),
      });
    }

    user.isVerified = true;
    await user.save();
    return res.status(200).json({ success: true });
  }

  async sendPasswordRecoveryEmail(req, res) {
    const User = req.appInfo.app.getModel('User');
    try {
      const user = await User.getUserByEmail(req.appInfo.request.email);
      if (!user) {
        return res
          .status(400)
          .json({ success: false, error: req.i18n.t('auth.errorUExist') });
      }
      await user.sendPasswordRecoveryEmail(req.i18n);
      return res.status(200).json({ success: true });
    } catch (e) {
      this.logger.error(e.message);
      return res
        .status(400)
        .json({ success: false, error: req.i18n.t('auth.errorUExist') });
    }
  }

  async recoverPassword(req, res) {
    const User = this.app.getModel('User');
    const user = await User.getUserByPasswordRecoveryToken(
      req.appInfo.request.passwordRecoveryToken,
    ).catch((e) => {
      this.logger.error(e.message);
      // eslint-disable-next-line no-console
      console.log(e);
    });

    if (!user) {
      return res
        .status(400)
        .json({ success: false, error: req.i18n.t('password.wrongToken') });
    }

    this.logger.debug(`Password recovery user is :${user}`);

    user.password = req.appInfo.request.password;
    user.isVerified = true;
    await user.save();
    return res.status(200).json({ success: true });
  }

  async sendVerification(req, res) {
    const User = this.app.getModel('User');
    const user = await User.getUserByEmail(req.appInfo.request.email);
    if (!user) {
      return res
        .status(400)
        .json({ success: false, error: req.i18n.t('auth.errorUExist') });
    }
    await user.sendVerificationEmail(req.i18n);
    return res.status(200).json({ success: true });
  }

  static get middleware() {
    return new Map([['/*', [PrepareAppInfo, GetUserByToken, RateLimiter]]]);
  }
}

module.exports = Auth;
