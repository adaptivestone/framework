const validator = require('validator');
const AbstractController = require('../modules/AbstractController');
const PrepareAppInfo = require('../services/http/middleware/PrepareAppInfo');
const GetUserByToken = require('../services/http/middleware/GetUserByToken');

class Auth extends AbstractController {
  get routes() {
    return {
      post: {
        '/login': 'postLogin',
        '/register': 'postRegister',
        '/logout': 'postLogout',
        '/verify': 'verifyUser',
        '/send-recovery-email': 'sendPasswordRecoveryEmail',
        '/recover-password': 'recoverPassword',
        '/send-verification': 'sendVerification',
      },
      get: {
        '/login': 'postLogin',
      },
    };
  }

  async postLogin(req, res, next) {
    let errors = {};
    if (!req.body.email) {
      errors.email = [req.i18n.t('auth.emailProvided')];
    }
    if (!req.body.password) {
      errors.password = [req.i18n.t('auth.passwordProvided')];
    }

    if (Object.keys(errors).length) {
      return res.status(400).json({ errors: errors });
    }
    let User = req.appInfo.app.getModel('User');
    let user = await User.getUserByEmailAndPassword(
      req.body.email,
      req.body.password,
    );
    if (!user) {
      return res.status(400).json({ error: req.i18n.t('auth.errorUPValid') });
    }
    if (!user.isVerified) {
      return res
        .status(400)
        .json({ error: req.i18n.t('email.notVerified'), notVerified: true });
    }
    let token = await user.generateToken();

    return res
      .status(200)
      .json({ success: true, token: token, user: user.getPublic() });
  }

  async postRegister(req, res, next) {
    let errors = {};
    if (!req.body.email) {
      errors.email = [req.i18n.t('auth.emailProvided')];
    } else if (
      !validator.isEmail(req.body.email, { allow_utf8_local_part: false })
    ) {
      errors.email = [req.i18n.t('auth.emailValid')];
    }
    if (!req.body.password) {
      errors.password = [req.i18n.t('auth.passwordProvided')];
    }
    if (!req.body.nickName.match(/^[a-zA-Z0-9_\-.]+$/)) {
      errors.nickName = [req.i18n.t('auth.nickNameValid')];
    }
    if (!req.body.password.match(/^[a-zA-Z0-9!@#$%ˆ^&*()_+\-{}[\]<>]+$/)) {
      errors.password = [req.i18n.t('auth.passwordValid')];
    }
    if (Object.keys(errors).length) {
      return res.status(400).json({ errors: errors });
    }
    let User = req.appInfo.app.getModel('User');
    let user = await User.getUserByEmail(req.body.email);
    if (user) {
      return res.status(400).json({ error: req.i18n.t('email.registered') });
    }
    user = await User.findOne({ 'name.nick': req.body.nickName });
    if (user) {
      return res.status(400).json({ error: req.i18n.t('auth.nicknameExists') });
    }
    user = await User.create({
      email: req.body.email,
      password: req.body.password,
      name: {
        first: req.body.firstName,
        last: req.body.lastName,
        nick: req.body.nickName,
      },
    });
    try {
      await user.sendVerificationEmail(req.i18n);
      return res.status(200).json({ success: true });
    } catch (e) {
      this.logger.error(e);
      return res.status(500).json({ success: false });
    }
  }

  postLogout(req, res, next) {
    //todo remove token
    return res.status(200).json({ success: true });
  }

  async verifyUser(req, res, next) {
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
    if (user) {
      user.isVerified = true;
      await user.save();
      return res.status(200).json({ success: true });
    }
  }
  async sendPasswordRecoveryEmail(req, res, next) {
    let User = req.appInfo.app.getModel('User');
    try {
      const user = await User.getUserByEmail(req.body.email);
      if (!user) {
        return res
          .status(400)
          .json({ success: false, error: req.i18n.t('auth.errorUExist') });
      }
      await user.sendPasswordRecoveryEmail(req.i18n);
      return res.status(200).json({ success: true });
    } catch (e) {
      this.logger.error(e);
      return res
        .status(400)
        .json({ success: false, error: req.i18n.t('auth.errorUExist') });
    }
  }
  async recoverPassword(req, res, next) {
    let user;
    const User = req.appInfo.app.getModel('User');

    const errors = {};
    if (!req.query.password.match(/^[a-zA-Z0-9!@#$%ˆ&*()_+\-{}[\]<>]+$/)) {
      errors.password = [req.i18n.t('auth.passwordValid')];
    }
    if (Object.keys(errors).length) {
      return res.status(400).json({ errors: errors });
    }
    try {
      user = await User.getUserByPasswordRecoveryToken(
        req.query.password_recovery_token,
      );
    } catch (e) {
      return res
        .status(400)
        .json({ success: false, error: req.i18n.t('password.wrongToken') });
    }
    this.logger.debug(`Password recovery user is :${user}`);
    if (user) {
      user.password = req.query.password;
      user.isVerified = true;
      await user.save();
      return res.status(200).json({ success: true });
    } else {
      return res
        .status(400)
        .json({ success: false, error: req.i18n.t('password.wrongToken') });
    }
  }
  async sendVerification(req, res, next) {
    const User = req.appInfo.app.getModel('User');
    const user = await User.getUserByEmail(req.body.email);
    if (!user) {
      return res
        .status(400)
        .json({ success: false, error: req.i18n.t('auth.errorUExist') });
    }
    await user.sendVerificationEmail(req.i18n);
    return res.status(200).json({ success: true });
  }
  static get middleware() {
    return new Map([['/', [PrepareAppInfo, GetUserByToken]]]);
  }
}

module.exports = Auth;
