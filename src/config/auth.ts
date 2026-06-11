export default {
  // @deprecated scrypt key length used only by the legacy (v1) password-hash
  // verify path. New hashes use the v2 scheme in helpers/crypto.ts, whose cost
  // params (N/r/p) live inside each stored hash. Do not treat this as a work
  // factor — it never was one.
  hashRounds: 64,
  saltSecret:
    process.env.AUTH_SALT ||
    console.error(
      'AUTH_SALT is not defined. You can "npm run cli generateRandomBytes" and use it',
    ),
  isAuthWithVefificationFlow: true,
  // Password hashing cost for the v2 scrypt scheme. `ln` = log2(N). Raise over
  // time to harden — existing hashes upgrade to the new cost on next login.
  // Tests lower this for speed; scrypt is memory-hard, so the production value
  // makes parallel hashing expensive on purpose.
  scrypt: { ln: 17, r: 8, p: 1 },
};
