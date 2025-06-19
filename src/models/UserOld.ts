import AbstractModel from '../modules/AbstractModel.ts';
import { appInstance } from '../helpers/appInstance.ts';
import type { IApp } from '../server.ts';
import { scryptAsync } from '../helpers/crypto.ts';

import type { TFunction } from 'i18next';

import type {
  IAbstractModel,
  IAbstractModelMethods,
} from '../modules/AbstractModel.ts';

interface IUser {
  avatar: string;
  name: {
    first: string;
    last: string;
    nick: string;
  };
  password: string;
  email: string;
  sessionTokens: {
    token: string;
    valid: Date;
  }[];
  verificationTokens: {
    until: Date;
    token: string;
  }[];
  passwordRecoveryTokens: {
    until: Date;
    token: string;
  }[];
  permissions: string[];
  roles: string[];
  isVerified: boolean;
  locale: string;
  languages: string[];
}

interface IStatic extends IAbstractModel<IUser, IAbstractModelMethods<IUser>> {
  getUserByEmailAndPassword(
    email: string,
    password: string,
  ): Promise<InstanceType<UserOld['mongooseModel']> | false>;
  hashPassword(password: string): Promise<string>;
  getUserByToken(
    token: string,
  ): Promise<InstanceType<UserOld['mongooseModel']> | false>;
  getUserByEmail(
    email: string,
  ): Promise<InstanceType<UserOld['mongooseModel']> | false>;
  getUserByPasswordRecoveryToken(
    token: string,
  ): Promise<InstanceType<UserOld['mongooseModel']> | false>;
  generateUserPasswordRecoveryToken(
    user: InstanceType<UserOld['mongooseModel']>,
  ): Promise<{ token: string; until: Date }>;
  getUserByVerificationToken(
    token: string,
  ): Promise<InstanceType<UserOld['mongooseModel']> | false>;
  generateUserVerificationToken(
    user: InstanceType<UserOld['mongooseModel']>,
  ): Promise<{ token: string; until: Date }>;
}

/**
 * @deprecated use User Model instead of UserOld
 */
class UserOld extends AbstractModel<
  IUser,
  IAbstractModelMethods<IUser>,
  IStatic
> {
  constructor(app: IApp) {
    console.warn(
      'UserOld model is deprecated. Please use User Model instead of UserOld',
    );
    super(app);
  }
  initHooks() {
    this.mongooseSchema.pre('save', async function userPreSaveHook() {
      if (this.isModified('password')) {
        // @ts-expect-error badtypes
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

  static async getUserByEmailAndPassword(
    this: UserOld['mongooseModel'],
    email: string,
    password: string,
  ) {
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

  async generateToken(this: InstanceType<UserOld['mongooseModel']>) {
    const { saltSecret, hashRounds } = appInstance.getConfig('auth') as {
      saltSecret: string;
      hashRounds: number;
    };
    const timestamp = new Date();
    timestamp.setDate(timestamp.getDate() + 30);
    const data = await scryptAsync(
      this.email + Date.now(),
      saltSecret,
      hashRounds,
    );
    const token = data.toString('base64url');
    this.sessionTokens.push({ token, valid: timestamp });
    await this.save();
    return { token, valid: timestamp };
  }

  getPublic(this: InstanceType<UserOld['mongooseModel']>) {
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

  static async hashPassword(this: UserOld['mongooseModel'], password: string) {
    const { saltSecret, hashRounds } = appInstance.getConfig('auth') as {
      saltSecret: string;
      hashRounds: number;
    };
    const data = await scryptAsync(String(password), saltSecret, hashRounds);
    return data.toString('base64url');
  }

  static async getUserByToken(this: UserOld['mongooseModel'], token: string) {
    const data = await this.findOne({ 'sessionTokens.token': String(token) });
    return data || false;
  }

  static async getUserByEmail(this: UserOld['mongooseModel'], email: string) {
    const data = await this.findOne({ email: String(email) });
    if (!data) {
      return false;
    }
    return data;
  }

  static async generateUserPasswordRecoveryToken(
    userMongoose: InstanceType<UserOld['mongooseModel']>,
  ) {
    const { saltSecret, hashRounds } = appInstance.getConfig('auth') as {
      saltSecret: string;
      hashRounds: number;
    };

    const date = new Date();
    date.setDate(date.getDate() + 14);
    const data = await scryptAsync(
      userMongoose.email + Date.now(),
      saltSecret,
      hashRounds,
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

  static async getUserByPasswordRecoveryToken(
    this: UserOld['mongooseModel'],
    passwordRecoveryToken: string,
  ) {
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

  async sendPasswordRecoveryEmail(
    this: InstanceType<UserOld['mongooseModel']>,
    i18n: { t: TFunction; language: string },
  ) {
    const passwordRecoveryToken =
      await UserOld.generateUserPasswordRecoveryToken(this);
    let Mailer;
    // speed optimisation
    try {
      // @ts-expect-error module is optional
      // eslint-disable-next-line import-x/no-unresolved
      Mailer = (await import('@adaptivestone/framework-module-email')).default;
    } catch {
      const error =
        'Mailer not found. Please install @adaptivestone/framework-module-email in order to use it';
      this.getSuper().logger?.error(error);
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

  static async generateUserVerificationToken(
    userMongoose: InstanceType<UserOld['mongooseModel']>,
  ) {
    const { saltSecret, hashRounds } = appInstance.getConfig('auth') as {
      saltSecret: string;
      hashRounds: number;
    };

    const date = new Date();
    date.setDate(date.getDate() + 14);
    const data = await scryptAsync(
      userMongoose.email + Date.now(),
      saltSecret,
      hashRounds,
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

  static async getUserByVerificationToken(
    this: UserOld['mongooseModel'],
    verificationToken: string,
  ) {
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

  async sendVerificationEmail(
    this: InstanceType<UserOld['mongooseModel']>,
    i18n: { t: TFunction; language: string },
  ) {
    const verificationToken = await UserOld.generateUserVerificationToken(this);
    // speed optimisation
    let Mailer;
    try {
      // @ts-expect-error module is optional
      // eslint-disable-next-line import-x/no-unresolved
      Mailer = (await import('@adaptivestone/framework-module-email')).default;
    } catch {
      const error =
        'Mailer not found. Please install @adaptivestone/framework-module-email in order to use it';
      this.getSuper().logger?.error(error);
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

export default UserOld;
