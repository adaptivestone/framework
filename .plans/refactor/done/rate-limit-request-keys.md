# Canonical rate-limit request keys

**Status**: ✅ implemented 2026-10-02 in the working tree; unreleased
**Release**: next minor `5.5.0` (security-relevant fix; behavior change: counters reset once)
**Origin**: consumer feedback. `consumeKeyComponents.request` keys on raw `req.body` values, because
route middleware runs before validation (`controllers/index.ts` `#wrapHandlerEntry`). Apps whose
lookup trims/lowercases (`ip: false, request: ['email']`, the documented login-protection example)
get a fresh bucket per spelling: `Foo@x.com`, `FOO@x.com`, and unlimited ` foo@x.com` whitespace
variants. Apps had to add a normalizing middleware before `RateLimiter`.

## Decision

Rule: the limiter key must treat as equal everything the account lookup treats as equal.
`RateLimiter` owns the key, not the lookup, so it canonicalizes the key (prior art: Laravel
Breeze/Fortify `Str::transliterate(Str::lower(email))` + global `TrimStrings`; django-allauth
`.lower()`, CVE-2026-97764 for the same bug class).

- Each configured request field: strings/numbers → `String(v).normalize('NFKC').trim().toLowerCase()`;
  other types and empty results are absent. Merging buckets only makes limiting stricter, so no
  opt-out; apps with stricter canonicalization (dots, `+tags`, accents) override `generateConsumeKey`.
- Present fields become `[field, value]` pairs (no more `{email:'a'}` ≡ `{phone:'a'}`), hashed:
  `sha256(JSON.stringify(pairs))` hex is the key's request part. Bounds key size and keeps raw
  values (e-mails) out of keys and the 429 `warn` log line. Pseudonymous, not anonymous: a known
  value can be hashed and compared.
- `gerenateConsumeKey` → `generateConsumeKey`. The old name stays as a deprecated alias until v6;
  a subclass still overriding it keeps working and gets a once-per-class `DeprecationWarning`.
- `config/rateLimiter.ts` comment fixed (values come from `req.body`, not `req.appInfo.request`).

## Rejected / deferred

- Post-validation limiter slot (Fastify `hook: 'preHandler'` style): deferred until validation becomes
  an explicit pipeline stage (`reference/decisions.md`), where it is ordering, not a new flag on the v1
  middleware contract P1m replaces. Also leaves 400s uncounted.
- Validation as an orderable middleware (Hono style): reworks route model and codegen typing.
- `consumeKey` function parameter: duplicates the subclass override.

## Files

`src/services/http/middleware/RateLimiter.ts`, `RateLimiter.test.ts`, `src/config/rateLimiter.ts`,
`CHANGELOG.md`; docs repo `docs/06-Controllers/03-middleware.md`.

## Out of scope

IP/user parts of the key; `Pagination` reading raw `req.query` (same class, separate); lookup-side
email normalization (`queued/email-normalization.md`).

## Done when

Case/whitespace/NFKC variants share one key; different fields with equal values do not; objects,
arrays and blank values are absent; keys hold no raw request value; an old-name override is still
used and warns once; the AGENTS.md gates pass.
