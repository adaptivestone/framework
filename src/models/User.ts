import { createHash, randomBytes } from 'node:crypto';
import type { TFunction } from 'i18next';
import type { Model, Schema } from 'mongoose';
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

/** A session-token sub-doc (`generateToken` / `getUserByToken`). */
type SessionToken = { token?: string | null; valid?: Date | null };
/** A verification / recovery sub-doc (carries an expiry, not a `valid` window). */
type ExpiringToken = { token?: string | null; until?: Date | null };

/**
 * The document fields the framework's auth statics & instance methods actually
 * read or write — typed **structurally**, not pinned to the framework's own
 * schema. A project that replaces `User` (extra fields, an i18n `name`, a
 * singular `role`, …) keeps the shipped auth logic callable on its model
 * without casts, as long as it preserves these few fields. This is what lets
 * `getModel('User').getUserByEmailAndPassword(…)` and friends type-check on a
 * customized model instead of forcing a `this`-binding cast at every call site.
 */
export interface UserAuthDoc {
  email?: string | null;
  password?: string | null;
  sessionTokens?: SessionToken[] | null;
  verificationTokens?: ExpiringToken[] | null;
  passwordRecoveryTokens?: ExpiringToken[] | null;
}

/** A hydrated {@link UserAuthDoc} the instance-side helpers bind to. */
export type UserAuthInstance = UserAuthDoc & { save: () => Promise<unknown> };

/** Any Mongoose `User` model the auth statics can bind to: one whose documents
 * carry {@link UserAuthDoc}. The framework's own `User` and a project's
 * replacement both satisfy it. */
export type UserAuthModel = Model<UserAuthDoc>;

/**
 * The fields `getPublic` reads, as a plain object (a `Pick` of the framework
 * document — NOT the Mongoose `Document` type, whose invariance would reject an
 * additive project model). Binding `this` to this keeps `getPublic`'s return
 * types PRECISE for every caller while still letting a project model that keeps
 * these fields reuse it. A model that reshapes them (e.g. an i18n `name`)
 * doesn't match and overrides `getPublic` with its own public shape.
 */
export type UserPublicDoc = Pick<
  InstanceType<UserModelLite>,
  'avatar' | 'name' | 'email' | 'id' | 'isVerified' | 'permissions' | 'locale'
>;

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

/**
 * The framework's default `User` model — and the intended customization point.
 * Two supported ways to replace it with a project model (drop yours in the
 * app's `models/` folder under the name `User`; codegen rebinds `getModel`,
 * `req.appInfo.user`, and `AppModels` to it):
 *
 * 1. **Add fields** — `extends User`, spread the schema, append your own:
 *    ```ts
 *    class User extends FrameworkUser {
 *      static get modelSchema() {
 *        return { ...FrameworkUser.modelSchema, company: { type: String } } as const;
 *      }
 *    }
 *    ```
 *    The inherited auth statics & instance methods keep working as-is.
 *
 * 2. **Reshape fields** (e.g. an i18n `name`, a singular `role`) — TypeScript
 *    can't express a field-type *replacement* through `extends` (the static-side
 *    getter override is checked covariantly → TS2417), so **compose**: extend
 *    {@link BaseModel} and reuse the auth logic by spreading it in.
 *    ```ts
 *    class User extends BaseModel {
 *      static get modelSchema() { return { ...your reshaped schema } as const; }
 *      static get modelStatics() { return { ...FrameworkUser.modelStatics } as const; }
 *      static get modelInstanceMethods() { return { ...FrameworkUser.modelInstanceMethods } as const; }
 *      static initHooks(schema: Schema) { FrameworkUser.initHooks(schema); }
 *    }
 *    ```
 *    The spread statics/methods are typed structurally ({@link UserAuthDoc} /
 *    {@link UserAuthModel}), so they stay callable on your model without casts.
 */
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
        T extends UserAuthModel,
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
      getUserByToken: async function getUserByToken<T extends UserAuthModel>(
        this: T,
        token: string,
      ) {
        const data = await this.findOne<InstanceType<T>>({
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
      getUserByEmail: async function getUserByEmail<T extends UserAuthModel>(
        this: T,
        email: string,
      ) {
        const data = await this.findOne<InstanceType<T>>({
          email: String(email),
        });
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
        async function getUserByPasswordRecoveryToken<T extends UserAuthModel>(
          this: T,
          passwordRecoveryToken: string,
        ) {
          const hashed = hashToken(String(passwordRecoveryToken));
          const data = await this.findOne<InstanceType<T>>({
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
      getUserByVerificationToken: async function getUserByVerificationToken<
        T extends UserAuthModel,
      >(this: T, verificationToken: string) {
        const hashed = hashToken(String(verificationToken));
        const data = await this.findOne<InstanceType<T>>({
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
    } as const;
  }

  static get modelInstanceMethods() {
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
        this: UserAuthInstance & { name?: { nick?: string | null } | null },
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
        this: UserAuthInstance & { name?: { nick?: string | null } | null },
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
      getPublic(this: UserPublicDoc) {
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
    userMongoose: UserAuthInstance,
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
      userMongoose: UserAuthInstance,
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
