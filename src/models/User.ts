import { BaseModel } from '../modules/BaseModel.ts';
import type {
  GetModelTypeLiteFromSchema,
  ExtractProperty,
} from '../modules/BaseModel.ts';
import { scryptAsyncWithSaltAsString } from '../helpers/crypto.ts';
import { appInstance } from '../helpers/appInstance.ts';
import type { Schema } from 'mongoose';

import type { TFunction } from 'i18next';

type UserModelLite = GetModelTypeLiteFromSchema<
  typeof User.modelSchema,
  ExtractProperty<typeof User, 'schemaOptions'>
>;
class User extends BaseModel {
  static initHooks(schema: Schema) {
    schema.pre(
      'save',
      async function userPreSaveHook(this: InstanceType<UserModelLite>) {
        if (this.isModified('password')) {
          this.password = await scryptAsyncWithSaltAsString(this.password!);
        }
      },
    );
  }

  static get modelSchema() {
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
    } as const;
  }

  static get modelStatics() {
    return {
      /**
       * Get user by email and password
       * @param {string} email
       * @param {string} password
       * @returns {Promise<InstanceType<UserModelLite> | false>}
       */
      getUserByEmailAndPassword: async function getUserByEmailAndPassword(
        this: UserModelLite,
        email: string,
        password: string,
      ) {
        const data = await this.findOne({ email: String(email) });
        if (!data) {
          return false;
        }
        const hashedPasswords = await scryptAsyncWithSaltAsString(password);

        if (data.password !== hashedPasswords) {
          return false;
        }
        return data;
      },
      /**
       * Get user by token
       * @param {string}
       * @returns {Promise<InstanceType<UserModelLite> | false>}
       */
      getUserByToken: async function getUserByToken(
        this: UserModelLite,
        token: string,
      ) {
        const data = await this.findOne({
          'sessionTokens.token': String(token),
        });
        return data || false;
      },
      /**
       * Get user by email
       * @param {string}
       * @returns {Promise<InstanceType<UserModelLite> | false>}
       */
      getUserByEmail: async function getUserByEmail(
        this: UserModelLite,
        email: string,
      ) {
        const data = await this.findOne({ email: String(email) });
        if (!data) {
          return false;
        }
        return data;
      },
      /**
       * Get user by password recovery token
       * @param {string} passwordRecoveryToken
       * @returns {Promise<InstanceType<UserModelLite> | false>}
       */
      getUserByPasswordRecoveryToken:
        async function getUserByPasswordRecoveryToken(
          this: UserModelLite,
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

          data.passwordRecoveryTokens?.pop();

          const result = await data.save();
          return result;
        },
      /**
       * Get user by verification token
       * @param {string} verificationToken
       * @returns {Promise<InstanceType<UserModelLite> | false>}
       */
      getUserByVerificationToken: async function getUserByVerificationToken(
        this: UserModelLite,
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

        data.verificationTokens?.pop();

        const result = await data.save();
        return result;
      },
      // TODO
      removeVerificationToken: async function removeVerificationToken(
        this: UserModelLite,
        verificationToken: string,
      ) {
        this.updateOne(
          {
            verificationTokens: {
              $elemMatch: { token: String(verificationToken) },
            },
          },
          { $pop: { verificationTokens: 1 } },
        );
      },
    } as const;
  }

  static get modelInstanceMethods() {
    type UserInstanceType = InstanceType<UserModelLite>;
    return {
      /**
       * Generate token for user
       * @returns {Object}
       */
      generateToken: async function (this: UserInstanceType) {
        const timestamp = new Date();
        timestamp.setDate(timestamp.getDate() + 30);
        const token = await scryptAsyncWithSaltAsString(
          this.email! + Date.now(),
        );
        this.sessionTokens?.push({ token, valid: timestamp });
        await this.save();
        return { token, valid: timestamp };
      },
      /**
       * Send password recovery email
       * @param {Object}
       * @param {TFunction}
       * @param {string} i18n.language
       * @returns {Promise<boolean>}
       */
      sendPasswordRecoveryEmail: async function (
        this: UserInstanceType,
        i18n: { t: TFunction; language: string },
      ) {
        const passwordRecoveryToken =
          await userHelpers.generateUserPasswordRecoveryToken(this);
        let Mailer;
        // speed optimisation
        try {
          // @ts-ignore
          // eslint-disable-next-line import-x/no-unresolved
          Mailer = (await import('@adaptivestone/framework-module-email'))
            .default;
        } catch {
          const error =
            'Mailer not found. Please install @adaptivestone/framework-module-email in order to use it';
          appInstance.logger?.error(error);
          return false;
        }

        const mail = new Mailer(
          appInstance,
          'recovery',
          {
            link: `${i18n.language}/auth/recovery?password_recovery_token=${passwordRecoveryToken.token}`,
            editor: this.name?.nick,
          },
          i18n,
        );
        return mail.send(this.email);
      },
      /**
       * Send verification email
       * @param {Object}
       * @param {TFunction} i18n.t
       * @param {string} i18n.language
       * @returns {Promise<boolean>}
       */
      sendVerificationEmail: async function (
        this: UserInstanceType,
        i18n: { t: TFunction; language: string },
      ) {
        const verificationToken =
          await userHelpers.generateUserVerificationToken(this);
        // speed optimisation
        let Mailer;
        try {
          // @ts-ignore
          Mailer = (await import('@adaptivestone/framework-module-email'))
            .default;
        } catch {
          const error =
            'Mailer not found. Please install @adaptivestone/framework-module-email in order to use it';
          appInstance.logger?.error(error);
          return false;
        }
        const mail = new Mailer(
          appInstance,
          'verification',
          {
            link: `${i18n.language}/auth/login?verification_token=${verificationToken.token}`,
            editor: this.name?.nick,
          },
          i18n,
        );
        return mail.send(this.email);
      } /**
       * Get public user data
       * @returns {Object}
       */,
      getPublic(this: UserInstanceType) {
        return {
          avatar: this.avatar,
          name: this.name,
          email: this.email,
          id: this.id,
          isVerified: this.isVerified,
          permissions: this.permissions,
          locale: this.locale,
        };
      },
    } as const;
  }
}

export const userHelpers = {
  /**
   * Generate user verification token
   * @param {InstanceType<UserModelLite>} userMongoose
   * @returns {Promise<{ token: string; until: number }>}
   */
  generateUserVerificationToken: async function generateUserVerificationToken(
    userMongoose: InstanceType<UserModelLite>,
  ) {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    const token = await scryptAsyncWithSaltAsString(
      userMongoose.email! + Date.now(),
    );
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
  },
  /**
   * Get user by id
   * @param {string}
   * @returns {Promise<InstanceType<UserModelLite> | false>}
   */
  generateUserPasswordRecoveryToken:
    async function generateUserPasswordRecoveryToken(
      userMongoose: InstanceType<UserModelLite>,
    ) {
      const date = new Date();
      date.setDate(date.getDate() + 14);
      const token = await scryptAsyncWithSaltAsString(
        userMongoose.email! + Date.now(),
      );

      userMongoose.passwordRecoveryTokens = [];
      userMongoose.passwordRecoveryTokens.push({
        until: date,
        token,
      });
      await userMongoose.save();
      return { token, until: date.getTime() };
    },
};

export default User;
