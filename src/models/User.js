import { scrypt } from 'node:crypto';

import { promisify } from 'node:util';
import AbstractModel from '../modules/AbstractModel.ts';

class User extends AbstractModel {
  constructor(app) {
    super(app);
    const authConfig = this.app.getConfig('auth');
    this.hashRounds = authConfig.hashRounds;
    this.saltSecret = authConfig.saltSecret;
  }

  initHooks() {
    this.mongooseSchema.pre('save', async function userPreSaveHook() {
      if (this.isModified('password')) {
        // @ts-ignore
        this.password = await this.constructor.hashPassword(this.password);
      }
    });
  }

  // eslint-disable-next-line class-methods-use-this
  get modelSchema() {
    return {
      avatar: {
        type: String,
        maxlength: 255,
      },
      name: {
        first: {
          type: String,
          maxlength: 255,
        },
        last: {
          type: String,
          maxlength: 255,
        },
        nick: {
          minlength: 3,
          maxlength: 255,
          type: String,
          index: {
            unique: true,
            partialFilterExpression: { 'name.nick': { $type: 'string' } },
          },
        },
      },
      password: String,
      email: {
        type: String,
        maxlength: 255,
        index: {
          unique: true,
          partialFilterExpression: { email: { $type: 'string' } },
        },
      },
      sessionTokens: [{ token: String, valid: Date }],
      verificationTokens: [{ until: Date, token: String }],
      passwordRecoveryTokens: [{ until: Date, token: String }],
      permissions: [],
      roles: [],
      isVerified: { type: Boolean, default: false },
      locale: { type: String, default: 'en' },
      languages: [String],
    };
  }

  static async getUserByEmailAndPassword(email, password) {
    const data = await this.findOne({ email: String(email) });
    if (!data) {
      return false;
    }
    const hashedPasswords = await this.hashPassword(password);

    if (data.password !== hashedPasswords) {
      return false;
    }
    return data;
  }

  async generateToken() {
    const timestamp = new Date();
    timestamp.setDate(timestamp.getDate() + 30);
    const scryptAsync = promisify(scrypt);
    const data = await scryptAsync(
      this.email + Date.now(),
      this.getSuper().saltSecret,
      this.getSuper().hashRounds,
    );
    const token = data.toString('base64url');
    this.sessionTokens.push({ token, valid: timestamp });
    await this.save();
    return { token, valid: timestamp };
  }

  getPublic() {
    return {
      avatar: this.avatar,
      name: this.name,
      email: this.email,
      id: this.id,
      isVerified: this.isVerified,
      permissions: this.permissions,
      locale: this.locale,
    };
  }

  static async hashPassword(password) {
    const scryptAsync = promisify(scrypt);
    const data = await scryptAsync(
      String(password),
      this.getSuper().saltSecret,
      this.getSuper().hashRounds,
    );
    return data.toString('base64url');
  }

  static async getUserByToken(token) {
    const data = await this.findOne({ 'sessionTokens.token': String(token) });
    return data || false;
  }

  static async getUserByEmail(email) {
    const data = await this.findOne({ email: String(email) });
    if (!data) {
      return false;
    }
    return data;
  }

  static async generateUserPasswordRecoveryToken(userMongoose) {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    const scryptAsync = promisify(scrypt);
    const data = await scryptAsync(
      userMongoose.email + Date.now(),
      userMongoose.getSuper().saltSecret,
      userMongoose.getSuper().hashRounds,
    );
    const token = data.toString('base64url');
    //       if (err) {
    //     this.logger.error("Hash 2 error ", err);
    //     reject(err);
    //     return;
    // }
    userMongoose.passwordRecoveryTokens = [];
    userMongoose.passwordRecoveryTokens.push({
      until: date,
      token,
    });
    await userMongoose.save();
    return { token, until: date.getTime() };
  }

  static async getUserByPasswordRecoveryToken(passwordRecoveryToken) {
    const data = await this.findOne({
      passwordRecoveryTokens: {
        $elemMatch: { token: String(passwordRecoveryToken) },
      },
    });
    if (!data) {
      return Promise.reject(new Error('User not exists'));
    }
    // TODO token expiration and remove that token

    data.passwordRecoveryTokens.pop();

    const result = await data.save();
    return result;
  }

  async sendPasswordRecoveryEmail(i18n) {
    const passwordRecoveryToken =
      await User.generateUserPasswordRecoveryToken(this);
    let Mailer;
    // speed optimisation
    try {
      // @ts-ignore
      // eslint-disable-next-line import-x/no-unresolved
      Mailer = (await import('@adaptivestone/framework-module-email')).default;
    } catch {
      const error =
        'Mailer not found. Please install @adaptivestone/framework-module-email in order to use it';
      this.getSuper().logger.error(error);
      return false;
    }

    const mail = new Mailer(
      this.getSuper().app,
      'recovery',
      {
        link: `${i18n.language}/auth/recovery?password_recovery_token=${passwordRecoveryToken.token}`,
        editor: this.name.nick,
      },
      i18n,
    );
    return mail.send(this.email);
  }

  static async generateUserVerificationToken(userMongoose) {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    const scryptAsync = promisify(scrypt);
    const data = await scryptAsync(
      userMongoose.email + Date.now(),
      userMongoose.getSuper().saltSecret,
      userMongoose.getSuper().hashRounds,
    );
    const token = data.toString('base64url');
    // if (err) {
    //     this.logger.error("Hash 2 error ", err);
    //     reject(err);
    //     return;
    // }
    userMongoose.verificationTokens = [];
    userMongoose.verificationTokens.push({
      until: date,
      token,
    });
    await userMongoose.save();
    return { token, until: date.getTime() };
  }

  static async getUserByVerificationToken(verificationToken) {
    const data = await this.findOne({
      verificationTokens: {
        $elemMatch: { token: String(verificationToken) },
      },
    });
    if (!data) {
      return Promise.reject(new Error('User not exists'));
    }
    // TODO token expiration and remove that token

    data.verificationTokens.pop();

    const result = await data.save();
    return result;
  }

  // async removeVerificationToken(verificationToken) {
  //   this.mongooseModel.updateOne(
  //     {
  //       verificationTokens: {
  //         $elemMatch: { token: String(verificationToken) },
  //       },
  //     },
  //     { $pop: { verificationTokens: 1 } },
  //   );
  // }

  async sendVerificationEmail(i18n) {
    const verificationToken = await User.generateUserVerificationToken(this);
    // speed optimisation
    let Mailer;
    try {
      // @ts-ignore
      // eslint-disable-next-line import-x/no-unresolved
      Mailer = (await import('@adaptivestone/framework-module-email')).default;
    } catch {
      const error =
        'Mailer not found. Please install @adaptivestone/framework-module-email in order to use it';
      this.getSuper().logger.error(error);
      return false;
    }
    const mail = new Mailer(
      this.getSuper().app,
      'verification',
      {
        link: `${i18n.language}/auth/login?verification_token=${verificationToken.token}`,
        editor: this.name.nick,
      },
      i18n,
    );
    return mail.send(this.email);
  }
}

export default User;
