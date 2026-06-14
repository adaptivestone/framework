/**
 * Type-level fixture (compiled only by `User.typecheck.test.ts`'s tsc gate,
 * excluded from the main build). It pins the guarantee behind issue-#2's fix:
 * the framework's `User` auth statics & instance methods stay callable on a
 * project's *customized* `User` model — both the additive (`extends User`) and
 * the divergent (compose + spread) shapes — with NO `this`-binding casts.
 *
 * `GetModelTypeFromClass<typeof X>` is exactly what a consumer's
 * `getModel('User')` resolves to (see `genTypes.d.ts`), so calling the methods
 * on it here reproduces real call sites. A regression in the structural typing
 * of `UserAuthDoc` / `UserAuthModel` makes this file fail `tsc`.
 */

import type { GetModelTypeFromClass } from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';
import User from '../User.ts';

/* ---- Additive customization: `extends User`, add a field, keep the rest. ---- */
class AdditiveUser extends User {
  static get modelSchema() {
    return {
      ...User.modelSchema,
      company: { type: String },
    } as const;
  }
}
type AdditiveHandle = GetModelTypeFromClass<typeof AdditiveUser>;

/* ---- Divergent customization: compose. Replace `name` with an i18n shape and
 * `roles[]` with a singular `role`, then reuse the framework auth logic by
 * spreading its statics/instance methods. `extends User` can't express a
 * field-shape *replacement* (TS2417 static covariance), so composition is the
 * supported path — and it must type-check without casts. ---- */
class DivergentUser extends BaseModel {
  static get modelSchema() {
    return {
      name: { native: { type: String }, machine: { type: String } },
      email: { type: String, maxlength: 255 },
      password: String,
      sessionTokens: [{ token: String, valid: Date }],
      verificationTokens: [{ until: Date, token: String }],
      passwordRecoveryTokens: [{ until: Date, token: String }],
      role: { type: String },
      company: { type: String },
      avatar: String,
      isVerified: { type: Boolean, default: false },
      permissions: [String],
      locale: { type: String, default: 'en' },
    } as const;
  }

  static get modelStatics() {
    return { ...User.modelStatics } as const;
  }

  static get modelInstanceMethods() {
    return { ...User.modelInstanceMethods } as const;
  }

  static initHooks(schema: Parameters<typeof User.initHooks>[0]) {
    User.initHooks(schema);
  }
}
type DivergentHandle = GetModelTypeFromClass<typeof DivergentUser>;

/** Exercise every reused auth method on both customized handles. No casts. */
export async function additive(M: AdditiveHandle) {
  const u = await M.getUserByEmailAndPassword('e@x.io', 'pw');
  if (u) {
    const company: string | null | undefined = u.company; // app-added field survives
    const email: string | null | undefined = u.email; // framework field survives
    void company;
    void email;
    await u.generateToken();
    // getPublic stays reusable AND keeps precise return types (not `unknown`):
    const pub = u.getPublic();
    const pubEmail: string | null | undefined = pub.email;
    const pubVerified: boolean | null | undefined = pub.isVerified;
    void pubEmail;
    void pubVerified;
  }
  await M.getUserByEmail('e@x.io');
  await M.getUserByToken('t');
  await M.getUserByVerificationToken('t');
  await M.getUserByPasswordRecoveryToken('t');
}

export async function divergent(M: DivergentHandle) {
  const u = await M.getUserByEmailAndPassword('e@x.io', 'pw');
  if (u) {
    const role: string | null | undefined = u.role; // app-replaced field
    void role;
    await u.generateToken();
  }
  await M.getUserByEmail('e@x.io');
  await M.getUserByToken('t');
  await M.getUserByVerificationToken('t');
  await M.getUserByPasswordRecoveryToken('t');
  // NOTE: `getPublic` is intentionally NOT reused here — this model reshapes
  // `name` (i18n), so its public shape differs and it overrides `getPublic`
  // with its own. The auth statics above, which don't touch `name`, are reused.
}
