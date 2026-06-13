import { createHash, randomBytes } from 'node:crypto';
import type { TFunction } from 'i18next';
import type { Schema } from 'mongoose';
import { appInstance } from '../helpers/appInstance.ts';
import {
  burnPasswordVerify,
  hashPassword,
  verifyPassword,
} from '../helpers/crypto.ts';
import type {
  ExtractProperty,
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
} from '../modules/BaseModel.ts';
import { BaseModel } from '../modules/BaseModel.ts';

/** A fresh, unguessable bearer token (43-char base64url, 256 bits). */
const createRandomToken = () => randomBytes(32).toString('base64url');

/**
 * Hash a token for storage/lookup. Tokens are high-entropy random values, so a
 * fast hash (SHA-256) is correct here — brute-force is infeasible and a slow
 * KDF would only add latency. Stored hashed so a DB read leak can't be replayed
 * as live bearer tokens. Exported so callers that match tokens directly (e.g.
 * logout's `$pull`) hash the same way.
 *
 * NOTE: `token` is ALWAYS a `createRandomToken()` output (256-bit `randomBytes`),
 * never a user-chosen password — including the `passwordRecoveryToken` /
 * `verificationToken` / `sessionToken` values that flow in. CodeQL's
 * `js/insufficient-password-hash` assumes low-entropy, human-chosen input and so
 * does not apply: a slow password KDF (bcrypt/scrypt/Argon2) would protect
 * nothing across a 2^256 search space. Real user passwords are hashed separately
 * with `hashPassword` (a proper KDF) in the `save` pre-hook below.
 */
export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('base64url');

export type UserModelLite = GetModelTypeLiteFromSchema<
  typeof User.modelSchema,
  ExtractProperty<typeof User, 'schemaOptions'>
>;

export type TUser = GetModelTypeFromClass<typeof User>;

/**
 * Augmentation point so `req.appInfo.user` follows a project's OWN `User` model
 * when it replaces the framework's. `npm run gen` emits this automatically into
 * `genTypes.d.ts` (mirroring how it types `app.getModel('User')`); declare it by
 * hand only if you don't run codegen. `User` must be the hydrated DOCUMENT type,
 * so wrap the model class in `InstanceType<GetModelTypeFromClass<…>>`:
 *
 *   import type { GetModelTypeFromClass } from '@adaptivestone/framework/modules/BaseModel.js';
 *   declare module '@adaptivestone/framework/models/User.js' {
 *     interface AppModels {
 *       User: InstanceType<GetModelTypeFromClass<typeof MyUser>>;
 *     }
 *   }
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentation target — empty by design
export interface AppModels {}

/**
 * The `User` instance type middlewares contribute to `req.appInfo.user`: the
 * project's own model when known (via `AppModels`), otherwise the framework's.
 * Keeps `appInfo.user` in sync with `app.getModel('User')`.
 */
export type AppUser = AppModels extends { User: infer U }
  ? U
  : InstanceType<TUser>;

class User extends BaseModel {
  static initHooks(schema: Schema) {
    schema.pre(
      'save',
      async function userPreSaveHook(this: InstanceType<UserModelLite>) {
        if (this.isModified('password')) {
          this.password = await hashPassword(this.password as string);
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
      permissions: [String],
      roles: [String],
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
      getUserByEmailAndPassword: async function getUserByEmailAndPassword<
        T extends UserModelLite,
      >(this: T, email: string, password: string) {
        const data = await this.findOne<InstanceType<T>>({
          email: String(email),
        });
        if (!data?.password) {
          // Equalize timing with the real verify path: a missing account (or one
          // without a password) must not be distinguishable by response latency.
          await burnPasswordVerify(password);
          return false;
        }
        const { valid, needsRehash } = await verifyPassword(
          password,
          data.password as string,
        );
        if (!valid) {
          return false;
        }
        // Login is the only time we hold the plaintext, so it is the only place
        // a legacy/under-target hash can be upgraded. Never fail the login if
        // the upgrade write fails — the user already authenticated correctly.
        if (needsRehash) {
          try {
            const newHash = await hashPassword(password);
            // Direct update bypasses the pre-save hook, which would otherwise
            // re-hash the already-hashed string and lock the user out.
            await this.updateOne({ _id: data._id }, { password: newHash });
          } catch (e) {
            appInstance.logger?.error('Failed to upgrade password hash', e);
          }
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
          sessionTokens: {
            $elemMatch: {
              token: hashToken(String(token)),
              valid: { $gt: new Date() },
            },
          },
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
          const hashed = hashToken(String(passwordRecoveryToken));
          const data = await this.findOne({
            passwordRecoveryTokens: {
              $elemMatch: {
                token: hashed,
                until: { $gt: new Date() },
              },
            },
          });
          if (!data) {
            return Promise.reject(new Error('User not exists'));
          }

          // Consume the matched token specifically — not just the last array
          // element — so a model that ever holds multiple tokens can't leave the
          // just-used one live.
          data.passwordRecoveryTokens = data.passwordRecoveryTokens?.filter(
            (t) => t.token !== hashed,
          ) as typeof data.passwordRecoveryTokens;

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
        const hashed = hashToken(String(verificationToken));
        const data = await this.findOne({
          verificationTokens: {
            $elemMatch: {
              token: hashed,
              until: { $gt: new Date() },
            },
          },
        });
        if (!data) {
          return Promise.reject(new Error('User not exists'));
        }

        // Consume the matched token specifically — not just the last array
        // element — so a model that ever holds multiple tokens can't leave the
        // just-used one live.
        data.verificationTokens = data.verificationTokens?.filter(
          (t) => t.token !== hashed,
        ) as typeof data.verificationTokens;

        const result = await data.save();
        return result;
      },
      // TODO
      // removeVerificationToken: async function removeVerificationToken(
      //   this: UserModelLite,
      //   verificationToken: string,
      // ) {
      //   this.updateOne(
      //     {
      //       verificationTokens: {
      //         $elemMatch: { token: String(verificationToken) },
      //       },
      //     },
      //     { $pop: { verificationTokens: 1 } },
      //   );
      // },
    } as const;
  }

  static get modelInstanceMethods() {
    type UserInstanceType = InstanceType<UserModelLite>;

    return {
      /**
       * Generate token for user
       * @returns {Object}
       */
      generateToken: async function (this: {
        email?: string | null;
        sessionTokens?: { token?: string | null; valid?: Date | null }[] | null;
        save: () => Promise<unknown>;
      }) {
        const timestamp = new Date();
        timestamp.setDate(timestamp.getDate() + 30);
        if (!this.email) {
          throw new Error('Email is required');
        }
        const token = createRandomToken();
        if (!this.sessionTokens) {
          this.sessionTokens = [];
        }
        // Prune already-expired tokens on append so the array can't grow
        // forever (keep only tokens still valid right now).
        const now = new Date();
        this.sessionTokens = this.sessionTokens.filter(
          (t) => t.valid && new Date(t.valid) > now,
        ) as typeof this.sessionTokens;
        this.sessionTokens.push({
          token: hashToken(token),
          valid: timestamp,
        } as (typeof this.sessionTokens)[number]);
        await this.save();
        // The raw token is returned to the caller exactly once; only its hash
        // is persisted. Wire format is unchanged.
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
        // speed optimisation
        try {
          // @ts-expect-error module is optional
          const Mailer = (await import('@adaptivestone/framework-module-email'))
            .default;
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
        } catch {
          const error =
            'Mailer not found. Please install @adaptivestone/framework-module-email in order to use it';
          appInstance.logger?.error(error);
          return false;
        }
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
        try {
          // @ts-expect-error module is optional
          const Mailer = (await import('@adaptivestone/framework-module-email'))
            .default;
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
        } catch {
          const error =
            'Mailer not found. Please install @adaptivestone/framework-module-email in order to use it';
          appInstance.logger?.error(error);
          return false;
        }
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
    if (!userMongoose.email) {
      throw new Error('Email is required');
    }
    const token = createRandomToken();
    userMongoose.verificationTokens = [];
    userMongoose.verificationTokens.push({
      until: date,
      token: hashToken(token),
    } as (typeof userMongoose.verificationTokens)[number]);
    await userMongoose.save();
    // Raw token goes into the email link; only its hash is persisted.
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
      if (!userMongoose.email) {
        throw new Error('Email is required');
      }
      const token = createRandomToken();

      userMongoose.passwordRecoveryTokens = [];
      userMongoose.passwordRecoveryTokens.push({
        until: date,
        token: hashToken(token),
      } as (typeof userMongoose.passwordRecoveryTokens)[number]);
      await userMongoose.save();
      // Raw token goes into the recovery email link; only its hash is persisted.
      return { token, until: date.getTime() };
    },
};

export default User;
