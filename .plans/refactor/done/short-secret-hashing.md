# Keyed hashing for short secrets (`hashSecret` / `verifySecret`)

**Status**: ✅ implemented 2026-10-01 in the working tree; unreleased
**Release**: next minor (`5.5.0` per semver — additive public API)
**Origin**: apps store 6-digit e-mail/SMS login and reset codes. `hashToken` (bare SHA-256) is
reversed in under a second for a 10^6 code space; `hashPassword` (scrypt, ~100 ms / 128 MB) puts
that cost on a public "send me a code" endpoint. Apps were hand-rolling `HMAC(code, AUTH_SALT)`.

## Decision

```ts
hashSecret(value: string, options: { purpose: string }): string            // base64url, 43 chars
verifySecret(value: string, stored: string, options: { purpose: string }): boolean
```

- **Recipe (frozen — stored hashes depend on it):** `key = HKDF-SHA256(ikm = AUTH_SALT, salt = '',
  info = 'hashSecret:' + purpose, 32)`; `hash = HMAC-SHA256(key, value)`, base64url. A known-answer
  test pins it; the vector was cross-checked against an independent RFC 5869 implementation.
- **HKDF, not the raw pepper:** `AUTH_SALT` is already the password pepper; deriving a key avoids
  using one secret across two primitives. The `hashSecret:` prefix keeps any future framework
  derivation from `AUTH_SALT` apart from app purposes.
- **`purpose` is required**, non-empty: each feature gets its own key, so the same code in two
  features hashes differently and never cross-verifies (prior art: Django `salted_hmac(key_salt)`,
  Rails `MessageVerifier` `purpose:`). An optional purpose would be omitted everywhere.
- **`verifySecret(value, stored)` instead of exporting a raw hash comparator:** mirrors
  `hashPassword`/`verifyPassword`, matches the real call pattern (hash candidate → constant-time
  compare), and removes `===` and raw-code-vs-hash misuse.
- **Errors:** missing `AUTH_SALT` → the shared `getPepper()` error; empty purpose → throws; a
  garbage or wrong-length stored hash → `false`, never a throw.
- **Sync, no key cache:** HKDF + HMAC cost microseconds; a cache would go stale under `updateConfig`.
- **Threat-model limit (documented):** a leak of both the database and `AUTH_SALT` reveals a
  6-digit code instantly; TTL and attempt locks remain the backstop. Rotating `AUTH_SALT`
  invalidates outstanding codes.

## Files

- `src/helpers/crypto.ts` — `hashSecret`, `verifySecret`, internal `hmacSecret`
- `src/helpers/crypto.test.ts` — determinism, value/purpose separation, known-answer vector,
  missing `AUTH_SALT`, empty purpose, verify true/false, truncated/malformed stored hash
- `CHANGELOG.md` — `Unreleased → Added`
- Docs repo `docs/14-helpers.md` — "Hashing secrets" section with the which-hash table

## Out of scope

- No `vN:` format prefix — hashes live minutes; a recipe change just expires outstanding codes.
- No code generator, no input normalization (the app trims/normalizes before both calls).
- `hashToken` stays in `models/User.ts`.

## Done when

`node --test … src/helpers/crypto.test.ts` passes, plus the full gates in `AGENTS.md`.
