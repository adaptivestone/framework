# P1a-runtime — Standard Schema runtime + ValidatorDriver pattern

**Status**: ✅ done (2026-05-04)
**Depends on**: P−1 (baseline), validation types
**Unblocks**: P1a-codegen
**Time**: shipped over a few sessions

## Goal (achieved)

Decouple framework runtime from yup. Replace today's class-hierarchy drivers (`AbstractValidator` / `YupValidator` / `CustomValidator`) with two small **functional drivers** dispatched by `ValidateService`. Standard Schema is the canonical interface; yup, zod, valibot, arktype all conform. Existing tests stay green.

## Architectural decisions (settled in `reference/decisions.md`)

- **Three concerns, two homes**:
  - Runtime validation + cast → `driver.validate(body, data)` (driver-side)
  - Compile-time TypeScript types → `StandardSchemaV1.InferOutput<typeof schema>` (schema-side, via `~standard.types.output`)
  - JSON Schema for OpenAPI → `driver.toJsonSchema?(body)` (driver-side; stub returns null until OpenAPI work fills in vendor-aware exporters)
- **`req:` context dropped** — audit (4 codebases, ~100 schemas) confirmed zero usage
- **Yup `stripUnknown` preserved** — audit found 8 sites in tht-server that spread `req.appInfo.request` into model creates; removing would be a security regression
- **Two-step `validateFields` + `castFields` collapsed** into a single `driver.validate(body, data)` returning the cast value
- **Yup vendor-aware path**: `body.validate(data, { stripUnknown: true, abortEarly: false })` in one shot; throws yup's `ValidationError` (translated via duck-typing — no top-level yup import in driver)
- **i18n auto-translation**: `ValidateService.validate(data, i18n?)` — when `i18n` is supplied, errors are translated in place before re-throwing. Drivers stay pure. `req.appInfo.i18n` flows through `AbstractController#validateRouteSlot`.
- **Yup as regular dep (Path A)**: framework's built-in `Auth` controller uses yup, so it ships as a direct dependency (~100KB). Zod is an optional peer for users who want to bring their own.

## Files shipped

**New**:
- `src/services/validate/types.ts` — `StandardSchemaV1` (inlined spec), `ValidationIssue`, `ValidationError` (interface), `ValidatorDriver`, `JsonSchema`.
- `src/services/validate/ValidationError.ts` — framework-owned class. `.message` is path-keyed payload (always-array values, wire-shape compatible with old yup pipeline). `.issues` is structured list for logging. `static isValidationError` for cross-realm checks.
- `src/services/validate/ValidateService.ts` — minimal dispatcher. Surface: `{constructor(app, schema), validate(data, i18n?), static resolve(schema), static register(driver, position?)}`. Throws at construction with migration message for legacy `{validate, cast}` shapes.
- `src/services/validate/drivers/StandardSchemaDriver.ts` — handles any `body['~standard']` (zod, valibot, arktype, custom user-implemented SS).
- `src/services/validate/drivers/YupDriver.ts` — vendor-aware (`vendor === 'yup'`). One call: `body.validate(data, { stripUnknown: true, abortEarly: false })`. Builds framework `ValidationError` via duck-typing on the thrown yup error (no top-level yup import).
- `src/services/http/middleware/schemas.ts` — `collectMiddlewareSchemas(app, controllerMws, routeMws, method, path, prefix)` helper. Walks middleware-info, returns the `relatedRequestParameters` / `relatedQueryParameters` declared by middlewares attached to the route.

**Edited**:
- `src/services/http/middleware/AbstractMiddleware.ts` — `relatedQueryParameters` / `relatedRequestParameters` defaults changed from `yup.object().shape({})` to `null`. Type as `StandardSchemaV1 | null`. Yup import removed.
- `src/services/http/middleware/Pagination.ts` — kept on yup (built-in middleware, matches `Auth.ts` default-controller pattern; Path A).
- `src/modules/AbstractController.ts` — `#validateRouteSlot` private method replaces the inline `validateFields` + `castFields` two-step. Calls `collectMiddlewareSchemas` + `new ValidateService(app, schema).validate(data, i18n)` for the route schema and each middleware schema, merges results. Passes `req.appInfo.i18n` for auto-translation.
- `src/services/documentation/DocumentationGenerator.js` — uses `collectMiddlewareSchemas` directly (no longer instantiates `ValidateService` for the walk). Per-schema field introspection stubbed `[]` until per-vendor `toJsonSchema` lands with OpenAPI work.
- `src/locales/{en,ru}/translation.json` — added `auth.passwordTooShort: "Password must be at least {{min}} characters"` (and Russian mirror) for the interpolation test fixture.
- `package.json` — yup `^1.0.0` → `^1.7.0` (Standard Schema requirement). Stays in `dependencies` (Path A — framework's built-in `Auth` requires it). Zod added as optional peer for downstream users who want to bring their own validator.

**Deleted**:
- `src/services/validate/ValidateService.js`
- `src/services/validate/drivers/AbstractValidator.{js,ts}`
- `src/services/validate/drivers/YupValidator.js`
- `src/services/validate/drivers/CustomValidator.js`
- `src/services/validate/drivers/LegacyDriver.ts` (legacy `{validate, cast}` shape removed entirely; framework throws migration-recipe error if it sees one)
- `src/services/validate/objectIdSchema.ts` (single-value SS schema didn't compose well; users use yup `.matches(/^[0-9a-fA-F]{24}$/)` or zod `.regex(...)` directly)

## API change

```ts
// types.ts
export interface StandardSchemaV1<I = unknown, O = I> { ... }   // inlined spec
export interface ValidationError extends Error {
  readonly name: 'ValidationError';
  readonly issues: ReadonlyArray<ValidationIssue>;
}
export interface ValidationIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
  readonly params?: Record<string, unknown>;   // for i18n interpolation
}
export interface ValidatorDriver {
  canHandle(body: unknown): boolean;
  validate(body: unknown, data: unknown): Promise<unknown>;
  toJsonSchema?(body: unknown, opts?: { target?: 'openapi-3.0' | 'draft-07' | 'draft-2020-12' }): JsonSchema | null;
}

// ValidateService.ts (entire surface)
class ValidateService extends Base {
  schema: unknown;
  driver: ValidatorDriver | null;
  static drivers: ValidatorDriver[] = [yupDriver, standardSchemaDriver];
  constructor(app: IApp, schema: unknown | null);
  async validate(data: unknown, i18n?: { t: TFunction } | null): Promise<unknown>;
  static resolve(schema: unknown): ValidatorDriver | null;
  static register(driver: ValidatorDriver, position?: 'first' | 'last'): void;
}
```

## Test results

- ✅ `npm run check:types` (`tsc --noEmit`) passes
- ✅ `npm run check` (biome) passes
- ✅ `npm test` — **132/132** tests pass (was 113 before this phase; +19 new validator + i18n tests)
- ✅ `grep -rn "from 'yup'" src/` returns only: `helpers/yup.ts` (YupFile helper), `controllers/Auth.ts`, `controllers/test/SomeController.ts`. Framework runtime infrastructure is yup-free.
- ✅ Test coverage: dispatch (yup → yupDriver, custom SS → standardSchemaDriver, legacy → migration error), strip-unknown preserved, ValidationError wire shape (always-array), legacy migration error message, i18n auto-translation (basic, interpolation), array paths, multi-error per field, multi-field with errors, register API (prepend + append).

## Out of scope (now / deferred to other phases)

- **Codegen** (`framework gen`, `Routes`, `Request<M, P>`) — P1a-codegen.
- **`AbstractMiddleware.static get provides()`** — typed phantom for codegen to consume; defer to P1a-codegen alongside the codegen output types.
- **Per-vendor `toJsonSchema` implementations** — OpenAPI work. Drivers stub `null` for now.
- **Built-in zod / valibot / arktype driver files** — only worth shipping when `toJsonSchema` lands. `standardSchemaDriver` covers all of them for validation today.
- **Splitting `AbstractController`** into `RouteRegistry` / `Pipeline` / `ExpressAdapter` — P1b.
- **Migrating `Auth.ts` / `SomeController.ts` away from yup** — Path A keeps these as built-in defaults using yup; future migration to inline Standard Schema would be a focused turn (~250 lines).

## Notes

- The framework's own controllers (`Auth.ts`, `SomeController.ts`) still use yup imports at the call site — these are user-replaceable defaults that demonstrate yup usage. The *framework runtime* (services, drivers, dispatchers) does not import yup at module top.
- `ValidationError.message` is always-array shape: `{ field: ['msg'] }` even for a single error. Constructor accepts `Record<string, string | string[]>` for input flexibility, but normalizes output to `Record<string, string[]>`.
- Yup-vendor driver and standard-schema dispatch behavior are unit-tested in isolation (each driver is a plain object — pass synthetic schemas, assert outputs).
- **No `req:` context** — drivers receive `(body, data)`. If a future use case requires it, add via `libraryOptions` per Standard Schema spec, NOT via a private framework convention. Audit found zero current uses.
- **i18n flow**: schema author writes keys (e.g. `'auth.emailProvided'`); framework's HTTP path passes `req.appInfo.i18n` to `validate()`; service translates errors in place before they propagate. For non-HTTP consumers (workers, RPC), they call `validate(data)` without i18n and get raw keys back — they choose if/how to translate.
- **i18n interpolation**: `ValidationIssue.params` carries yup's `inner.params` (e.g., `{min: 8}`). The translator passes them to `t(message, fallback, params)`, so locale strings can use `{{min}}` syntax.
- **Forward-compat note (lands in P1b, not P1a-runtime)**: `YupFile.check` semantics flip from "array of `PersistentFile`" to "single `PersistentFile`" in **P1b** alongside the multipart parser changes. P1a-runtime ships only the validator architecture; **P1b** introduces the `multipartScalar(inner)` helper (`src/helpers/multipart.ts`) that wraps any Standard-Schema validator with single-element-array auto-unwrap. See `decisions.md` → "Multipart parser is always-array" for the full story.
