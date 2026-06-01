# P1k — Yup optional (un-bundle the validator)

**Status**: ✅ shipped (beta.51, commit `2f0655d`).
**Depends on**: P1a-runtime (Standard Schema dispatch + `standardSchemaDriver` shipped)

> **Shipped reality (differs from this plan below):** `defineSchema` + a vendor-neutral `File` export (`@adaptivestone/framework/types.js`) landed; `Auth`/`Pagination` migrated off yup; yup moved to an optional `peerDependency`. **`YupFile` was deprecated** (JSDoc `@deprecated` + a runtime `DeprecationWarning`, removal in v6) rather than kept unchanged. Also shipped beyond this doc's scope: **content-type-keyed request schemas** (`request` accepts a media-type map → `contentType`-discriminated union, 415 on no match). The `multipartScalar` helper was prototyped and **dropped** in favor of validator-native cardinality + a planned route-level option. See CHANGELOG `[5.0.0-beta.51]`.


**Time**: ~½ day
**Parallelizable with**: everything (isolated to the validate layer + 3 built-in files)
**Origin**: surfaced 2026-05-31 — yup is in `dependencies` only because ~6 trivial built-in schemas (Auth + Pagination + `YupFile`) use it. Goal: framework ships **no** bundled validator, while keeping typed route generation. P1a left this as out-of-scope ("future migration to inline Standard Schema, ~250 lines").

## Goal

Move yup out of `dependencies`. Rewrite the handful of built-in schemas as hand-authored Standard Schema objects via a tiny `defineSchema` helper. Codegen keeps producing typed handler requests unchanged — it already reads `StandardSchemaV1.InferOutput`, which is validator-agnostic.

## Why

- **Abstract, no useless deps.** The runtime is already Standard-Schema-based (P1a). Yup is the last bundled validator, dragged in only by built-in defaults. Modern users mostly bring zod.
- **Type generation already supports this.** `emit.ts` emits `StandardSchemaV1.InferOutput<...['request']>` — it reads the schema's phantom `~standard.types.output`, so a hand-declared `defineSchema<T>` output type flows through with **zero codegen changes**.
- **Yup support is retained, just un-bundled.** The `yupDriver` has no top-level yup import (duck-typed); it keeps working for users who add yup as an optional peer.

## Files touched

- `src/services/validate/defineSchema.ts` (new) — the helper (see API). ~10 lines.
- `src/controllers/Auth.ts` — replace the 5 `object().shape({...})` schemas with `defineSchema<T>`. Drop `import { object, string } from 'yup'`.
- `src/services/http/middleware/Pagination.ts` — replace yup query schema with `defineSchema<T>`.
- `src/helpers/yup.ts` — **unchanged**. `YupFile` stays as the yup-specific file validator. It is only loaded when a user `import`s it, and those users have yup (now an optional peer) installed. **No built-in controller validates files**, so file validation is entirely outside P1k's path. The vendor-neutral file story (`File` export + `multipartScalar`) is a separate track — see Out of scope and `decisions.md` → "Standard-Schema-only file validation".
- `src/locales/*` — ensure i18n keys for hand-rolled messages (`validation.email`, `validation.required`, pagination keys) exist; reuse existing yup message keys where possible so wire/i18n output is unchanged.
- `package.json` — yup `^1.7.0`: `dependencies` → `devDependencies` (keeps fixtures + `yupDriver` tests running). Add `yup` to `peerDependenciesMeta` as optional (alongside `zod`).
- **Unchanged on purpose**: `src/tests/fixtures/controllers/SomeController.ts` + `src/services/validate/ValidateService.test.ts` keep using yup — they are the living test of the `yupDriver` vendor path (yup is now a devDependency).

## API

```ts
// src/services/validate/defineSchema.ts
import type { StandardSchemaV1 } from './types.ts';

/**
 * Wrap a validate function into a Standard Schema object — zero deps.
 * `Output` is what codegen reads for handler types (InferOutput); you declare
 * it, the runtime checks live in `validate`. Unknown keys are stripped by
 * construction (return only known fields in the success `value`).
 */
export function defineSchema<Output>(
  validate: (value: unknown) => StandardSchemaV1.Result<Output>,
): StandardSchemaV1<unknown, Output> {
  return { '~standard': { version: 1, vendor: 'framework', validate } };
}
```

```ts
// migrated Auth login schema
type LoginRequest = { email: string; password: string };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const loginSchema = defineSchema<LoginRequest>((value) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const issues: StandardSchemaV1.Issue[] = [];
  if (typeof v.email !== 'string' || !EMAIL.test(v.email))
    issues.push({ message: 'validation.email', path: ['email'] });
  if (typeof v.password !== 'string' || !v.password)
    issues.push({ message: 'validation.required', path: ['password'] });
  if (issues.length) return { issues };
  return { value: { email: v.email as string, password: v.password as string } };
});
```

No new driver: `standardSchemaDriver` already handles any non-yup `~standard` object — calls `validate`, builds the framework `ValidationError` from `issues`, i18n-translates by `message` key.

## Test plan

- ☐ `defineSchema.test.ts` — success returns `{value}` with unknowns stripped; failure returns `{issues}`; type-level assert `InferOutput<typeof loginSchema>` equals `LoginRequest`.
- ☐ Auth integration tests stay green — login/register reject invalid email + missing password with the **same wire shape** as before.
- ☐ `ValidationError` byte-identical response test (existing cross-phase fixture) stays green.
- ☐ i18n: invalid-field messages still translate (keys reused).
- ☐ `npm run gen && tsc --noEmit` — generated handler `request` types still resolve via `InferOutput` on `defineSchema`.
- ☐ `grep -rn "from 'yup'" src/` returns only `helpers/yup.ts` (YupFile — user opt-in), `tests/fixtures/.../SomeController.ts`, `ValidateService.test.ts`. The **runtime + built-in controllers (Auth, Pagination)** are yup-free.
- ☐ Fresh install without yup in production deps boots and serves `/auth/login` validation.

## Out of scope

- **No schema-builder combinators** (`string()`, `object()`, `min()`, `email()`). That is rebuilding zod and owning its edge-case bugs — the explicit anti-goal. If `defineSchema`'s `if`-checks ever feel too verbose across *many* schemas, the answer is "install zod," not "grow this helper."
- **Not removing yup support.** `yupDriver` stays shipped; yup stays an optional peer.
- **File validation.** No built-in validates files, so P1k does not touch it. `YupFile` stays as the yup-specific helper. The vendor-neutral file path (`File` type export, `multipartScalar`, optional `fileSchema()`) is its own track per `decisions.md` → "Standard-Schema-only file validation" / "Multipart parser is always-array" — out of scope here.
- **Not migrating user apps** or user-facing schemas.
- **Full docs rewrite** — `05-models.md`/validation docs adding `defineSchema` is folded into P1g docs-sweep; this phase only ships the code + a CHANGELOG note.

## Done when

- `yup` is **not** in `package.json#dependencies`; `defineSchema` + `fileSchema` ship; `Auth.ts` + `Pagination.ts` import no yup; all existing tests green; `npm run gen && tsc --noEmit` clean.

## Notes

- **The one cost**: `defineSchema`'s declared `Output` type and its `validate` body are two hand-synced declarations — no `InferType` deriving one from the other, and codegen trusts the declared type without cross-checking `validate`. Acceptable for ~6 fixed, rarely-touched built-in schemas; **not** a pattern to push on large user apps (there, zod).
- `defineSchema` is a useful **public** export: a zero-dep escape hatch for simple validators. Reinforces the "framework bundles no validator; bring zod/yup for rich needs" story.
- Stripping is automatic — success `value` only carries the keys you copy, so the yup `stripUnknown` security property (8 spread-into-`Model.create` sites audited in P1a) is preserved by construction.
- **Migration note (CHANGELOG):** users who use `YupFile` — or any yup schema in their own controllers — must add `yup` to *their own* `dependencies` after P1k. It is no longer provided transitively by the framework. This is correct semantics (depend on the validator you use), but it is a user-visible breaking change to call out.
