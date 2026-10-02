import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type authConfig from '../config/auth.ts';
import { appInstance } from './appInstance.ts';

export const scryptAsync = promisify<
  string | Buffer | DataView,
  string | Buffer | DataView,
  number,
  Buffer
>(scrypt);

/**
 * scrypt with explicit cost options. The 3-arg `scryptAsync` above cannot pass
 * N/r/p, so the v2 password scheme uses this wrapper.
 */
const scryptWithOptions = (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) {
        reject(err);
      } else {
        resolve(derivedKey);
      }
    });
  });

/** The `AUTH_SALT` pepper: a second secret mixed in but never stored. */
const getPepper = () => {
  const { saltSecret } = appInstance.getConfig('auth') as typeof authConfig;
  if (!saltSecret) {
    throw new Error(
      'saltSecret should be set up. AUTH_SALT is not defined. You can "npm run cli generateRandomBytes" and use it',
    );
  }
  return saltSecret;
};

/**
 * Legacy (v1) derivation: `scrypt(input, AUTH_SALT, hashRounds)`. Kept only for
 * verifying pre-existing v1 password hashes (see {@link verifyPassword}). Do not
 * use for new hashes — {@link hashPassword} is the current scheme.
 */
export const scryptAsyncWithSalt = async (stringToHash: string) => {
  const { hashRounds } = appInstance.getConfig('auth') as typeof authConfig;
  const res = await scryptAsync(stringToHash, getPepper(), hashRounds);
  return res;
};

export const scryptAsyncWithSaltAsString = async (stringToHash: string) => {
  const res = await scryptAsyncWithSalt(stringToHash);
  return res.toString('base64url');
};

// --- Password hashing -------------------------------------------------------
//
// Stored format is versioned; the version owns everything after it:
//   v2:scrypt:ln=17,r=8,p=1:<saltBase64url>:<hashBase64url>
// `v1` (legacy) is the bare base64url `scrypt(password, AUTH_SALT)` hash with no
// prefix. base64url's alphabet (A-Za-z0-9-_) never contains ':', so the absence
// of a `vN:` prefix unambiguously means v1. Cost params live INSIDE the payload
// so cost can be ratcheted without a version bump; the version is reserved for
// structural recipe changes.

const SCRYPT_KEYLEN = 64;
// Cost used when `auth.scrypt` is absent (e.g. a project that replaced the auth
// config). ln = log2(N).
const SCRYPT_DEFAULTS = { ln: 17, r: 8, p: 1 };

/** Current target cost: `auth.scrypt` if configured, else the built-in default. */
const getScryptParams = () => {
  const { scrypt: cfg } = appInstance.getConfig('auth') as typeof authConfig;
  return { ...SCRYPT_DEFAULTS, ...cfg };
};

// Hard ceiling on scrypt working memory (under Node's ~INT_MAX maxmem cap).
// Allows realistic ratcheting (≈ up to ln=20, r=8 → ~1 GiB) while bounding the
// allocation a tampered/corrupted stored hash can request: an absurd `ln`/`r`
// makes the required memory exceed this, so scrypt rejects it up front instead
// of attempting a huge allocation.
const SCRYPT_MAXMEM_CEILING = 1536 * 1024 * 1024; // 1.5 GiB

// scrypt needs ~128*N*r bytes; size maxmem from the actual params (with
// headroom, capped) so cost can be ratcheted in either direction without
// tripping Node's 32 MB default or failing to verify a higher-cost stored hash.
const scryptMaxmem = (ln: number, r: number) =>
  Math.min(128 * 2 ** ln * r * 2, SCRYPT_MAXMEM_CEILING);

/** Hash a password with the current (v2) scheme: per-user salt + pepper. */
export const hashPassword = async (password: string) => {
  const pepper = getPepper();
  const { ln, r, p } = getScryptParams();
  const salt = randomBytes(16);
  const hash = await scryptWithOptions(password + pepper, salt, SCRYPT_KEYLEN, {
    N: 2 ** ln,
    r,
    p,
    maxmem: scryptMaxmem(ln, r),
  });
  return `v2:scrypt:ln=${ln},r=${r},p=${p}:${salt.toString(
    'base64url',
  )}:${hash.toString('base64url')}`;
};

const timingSafeEqualBuffers = (a: Buffer, b: Buffer) =>
  a.length === b.length && timingSafeEqual(a, b);

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/**
 * Compare two secret strings (tokens, API keys, webhook signatures) in constant
 * time. Hashing first gives equal-length inputs, so the length isn't leaked either.
 */
export const timingSafeEqualStrings = (a: string, b: string) =>
  timingSafeEqual(sha256(a), sha256(b));

/**
 * Verify a password against a stored hash of any scheme version.
 * @returns `valid` — does the password match; `needsRehash` — should the caller
 * re-hash with the current scheme (legacy hash, or cost below current target).
 */
export const verifyPassword = async (
  password: string,
  stored: string,
): Promise<{ valid: boolean; needsRehash: boolean }> => {
  const pepper = getPepper();

  // The scheme version leads the string (e.g. `v2:`); base64url never contains
  // ':', so a bare hash with no `vN:` prefix is the legacy v1 format.
  const versionMatch = stored.match(/^v(\d+):/);

  // v1 (legacy): bare base64url scrypt(password, AUTH_SALT, hashRounds).
  // Keep this branch until you are willing to force-reset accounts that never
  // logged in since the v2 rollout — their hashes stay v1 forever.
  if (!versionMatch) {
    const candidate = await scryptAsyncWithSalt(password);
    const valid = timingSafeEqualBuffers(
      candidate,
      Buffer.from(stored, 'base64url'),
    );
    return { valid, needsRehash: valid };
  }

  // A known `vN:` prefix we don't implement (e.g. a future v3) must fail safely
  // rather than be mis-handled as the legacy v1 format.
  if (versionMatch[1] !== '2') {
    return { valid: false, needsRehash: false };
  }

  // v2: parse params + salt, re-derive, constant-time compare. A corrupted or
  // truncated v2 string (missing parts, non-numeric cost) must fail cleanly,
  // not 500 the login — so guard the whole parse/derive.
  try {
    const [, algo, paramStr, saltB64, hashB64] = stored.split(':');
    if (algo !== 'scrypt') {
      return { valid: false, needsRehash: false };
    }
    const params = Object.fromEntries(
      paramStr.split(',').map((kv) => {
        const [k, v] = kv.split('=');
        return [k, Number(v)];
      }),
    ) as { ln: number; r: number; p: number };
    if (
      !Number.isInteger(params.ln) ||
      !Number.isInteger(params.r) ||
      !Number.isInteger(params.p)
    ) {
      return { valid: false, needsRehash: false };
    }
    const storedHash = Buffer.from(hashB64, 'base64url');
    const candidate = await scryptWithOptions(
      password + pepper,
      Buffer.from(saltB64, 'base64url'),
      storedHash.length,
      {
        N: 2 ** params.ln,
        r: params.r,
        p: params.p,
        maxmem: scryptMaxmem(params.ln, params.r),
      },
    );
    const valid = timingSafeEqualBuffers(candidate, storedHash);
    const target = getScryptParams();
    const needsRehash =
      valid &&
      (params.ln < target.ln || params.r < target.r || params.p < target.p);
    return { valid, needsRehash };
  } catch {
    return { valid: false, needsRehash: false };
  }
};

// A throwaway v2 hash, computed once at the current cost, used only to equalize
// timing. The comparison result is discarded.
let dummyHashPromise: Promise<string> | null = null;

/**
 * Burn one password-verify's worth of scrypt work, then discard the result.
 * Call this on the "no such user / no password" branch of a login so that a
 * non-existent account is not distinguishable from a wrong password by response
 * latency — i.e. it closes the user-enumeration timing oracle.
 */
export const burnPasswordVerify = async (password: string): Promise<void> => {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('framework:timing-equalizer');
  }
  try {
    await verifyPassword(password, await dummyHashPromise);
  } catch {
    // Timing side effect only — any error here is irrelevant.
  }
};

// --- Short secrets ----------------------------------------------------------
//
// One-time codes (e-mail/SMS login, reset) are too low-entropy for a bare
// SHA-256: a 6-digit code's 10^6 values fall to a leaked hash in under a
// second. An HMAC keyed from AUTH_SALT makes a leaked hash useless without the
// secret, at microseconds per call where scrypt costs ~100 ms and 128 MB.
// Stored hashes depend on this exact recipe — changing it invalidates them.

/** HMAC-SHA256 under a per-purpose key derived from AUTH_SALT with HKDF. */
const hmacSecret = (value: string, purpose: string) => {
  if (!purpose) {
    throw new Error('Secret hashing purpose is required, e.g. "email-login"');
  }
  const key = hkdfSync('sha256', getPepper(), '', `hashSecret:${purpose}`, 32);
  return createHmac('sha256', Buffer.from(key)).update(value).digest();
};

/**
 * Hash a short, low-entropy secret such as a 6-digit login code (base64url).
 * Keyed with `AUTH_SALT`: a leaked hash cannot be brute-forced without it, and
 * rotating `AUTH_SALT` invalidates every stored hash. `purpose` names the
 * feature; a hash made for one purpose never verifies under another.
 * For long random tokens use `hashToken`; for passwords use `hashPassword`.
 */
export const hashSecret = (value: string, { purpose }: { purpose: string }) =>
  hmacSecret(value, purpose).toString('base64url');

/** Constant-time check of `value` against a {@link hashSecret} result. */
export const verifySecret = (
  value: string,
  stored: string,
  { purpose }: { purpose: string },
) =>
  timingSafeEqualBuffers(
    hmacSecret(value, purpose),
    Buffer.from(stored, 'base64url'),
  );
