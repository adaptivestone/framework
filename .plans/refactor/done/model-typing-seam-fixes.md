# Side — Model typing seam fixes (Mongoose 9.9.4 audit follow-up)

**Status**: ✅ done (2026-09-01 — in the working tree, unreleased; lands with the next release after 5.4.0)
**Depends on**: nothing (edits the existing `GetModelTypeFromClass` machinery in `src/modules/BaseModel.ts` and the `AppModel` alias in `src/server.ts`)
**Unblocks**: nothing
**Spec**: the 2026-09-01 typing audit (this file is its record; there is no separate spec)

## Goal (one-line)

Fix the four places where the model types contradict runtime: the forced `id`
virtual, the sibling `_id: false` spelling, the unqueryable `AppModel` union,
and virtuals that collapse to `never` — each landing with a fixture assertion.

## Why (origin)

A 2026-09-01 audit of `BaseModel.ts` against Mongoose 9.9.4's shipped type
declarations (two review agents plus an independent second opinion, every claim
reproduced with the repo's `tsc`) found the layer fundamentally sound: every
generic slot is correct, the readonly normalization, timestamps typing,
subdocument `_id` corrections and the Schema-instance leaf guard are all still
required upstream, and the `any` slots in the Lite type do not leak. The
defects are at the seams, and three of the four sit exactly where the fixture
gate does not look. Not in scope here, recorded for later: `DocFacingMethods`
is dead weight (Mongoose's `HydratedDocument` strips `this` itself); schema
options are never threaded into `InferRawDocType` / `InferHydratedDocType`
(top-level `_id: false`, `typeKey`); `initHooks(_schema: Schema)` erases hook
`this`; query helpers and the discriminator key are unsupported; `Mixed` is
`any`; the Lite type's second argument is spelled three ways.

## Global constraints

- **No commits, no pushes.** Leave every change in the working tree; the
  maintainer reviews the diff and does their own git. No attribution trailers.
- **Fixture-first.** Each type change lands with its fixture assertion written
  and shown failing (RED) before the fix, then passing (GREEN). Assertions use
  an exact-type check, not assignability — `never` and `any` satisfy
  assignability and are precisely the bugs being fixed.
- **Fixture gate:** `node_modules/.bin/tsc --noEmit -p src/models/__fixtures__/tsconfig.json`
  (run from the repo root; ~5 s). Model fixtures are self-contained files
  under `src/models/__fixtures__/`, listed in the header comment of
  `src/models/ModelTyping.typecheck.test.ts`. The codegen fixture
  `src/codegen/__fixtures__/appModelLookup.ts` is compiled by
  `src/codegen/routeTypes.golden.test.ts`.
- **Verification before claiming done:** the fixture gate, `npm run check:types`,
  `npm run check:types:tests`, `npm run check` (biome), and the node test file
  covering the touched fixture. The controller runs `npm test` and
  `npm run smoke` once at the end.
- **Style:** biome is the arbiter (`npm run check:fix` for formatting); compact
  JSDoc in the voice of the surrounding comments; no `any`
  (`noExplicitAny`); `as const` schemas; no Express or reference-project
  names in comments.
- **Do not touch:** `CHANGELOG.md`, this plan file, `genTypes.d.ts` (codegen
  output), `DocFacingMethods`, or anything listed under "Not in scope" above.
  `AbstractModel` / `UserOld` stay as they are (v6 removal).

## Tasks

### Task 1: Stop forcing the `id` virtual

**File:** `src/modules/BaseModel.ts`, `HydratedDocumentFromClass` (around
lines 518-528). The `TOverrides` slot is currently

```ts
VirtualType<ExtractProperty<T, 'modelVirtuals'>> &
  DocFacingMethods<ExtractProperty<T, 'modelInstanceMethods'>> & {
    id: string;
  },
```

Delete the `& { id: string }` intersection so the slot is
`VirtualType<…> & DocFacingMethods<…>`. Mongoose 9.9.4 adds the `id` virtual
itself through `AddDefaultId` (`node_modules/mongoose/types/inferschematype.d.ts`,
used by `HydratedDocument` in `types/index.d.ts`): `id: string` unless the
schema options carry `id: false` or the schema defines an `id` path. Forcing
it back on produces `doc.id: string` when the runtime value is `undefined`
(`id: false`) or a number (`id: { type: Number }`), and collapses a custom
`id` virtual to `never`. Nothing else in the file changes.

**Fixture (write first):** new `src/models/__fixtures__/idVirtual.ts`,
self-contained like its siblings, with a short header comment in the same
voice, asserting with an exact-type helper (a `const ok: Exact<A, B> = true`
pattern or the file's own equivalent):

- default model (no `schemaOptions`): the hydrated document's `id` is exactly
  `string`;
- `static get schemaOptions() { return { id: false } as const; }`: `'id'` is
  not a key of the hydrated document (both the class-derived document and the
  `GetModelTypeLiteFromSchema<typeof X.modelSchema, typeof X.schemaOptions>`
  document);
- schema field `id: { type: Number, required: true }`: the hydrated document's
  `id` is exactly `number`.

Add `idVirtual.ts` to the fixture list in the header comment of
`src/models/ModelTyping.typecheck.test.ts`. RED: the gate fails on the
`id: false` and `id: Number` assertions. GREEN after the deletion; the entire
existing gate must stay green.

### Task 2: Honour the sibling `_id: false` spelling on hydrated documents

**File:** `src/modules/BaseModel.ts`, `CorrectHydratedSubdocumentIds`, the
single-nested branch (around lines 386-397) that builds

```ts
CorrectHydratedSubdocumentElement<
  InferRawDocType<MutableSchemaForInference<SchemaSingleNestedDefinition<Schema[K]>>>,
  SchemaSingleNestedDefinition<Schema[K]>
>
```

A single-nested field spelled `field: { type: { … }, _id: false }` carries the
marker on the *wrapper*; `SchemaSingleNestedDefinition` unwraps to the inner
definition, so by the time `CorrectHydratedSubdocumentElement` tests
`Schema extends { readonly _id: false }` the marker is gone and the hydrated
type keeps `_id: ObjectId` while the runtime has none. (The spelling with
`_id: false` *inside* `type:` works because the marker survives the unwrap.)
Re-attach the marker when the wrapper has it — pass, as the second argument,

```ts
Schema[K] extends { readonly _id: false }
  ? SchemaSingleNestedDefinition<Schema[K]> & { readonly _id: false }
  : SchemaSingleNestedDefinition<Schema[K]>
```

(a small named helper type is fine if it reads better). The raw surface is
already correct — `InferRawDocType` handles both spellings natively — so
`CorrectRawSubdocumentIds` stays untouched unless the fixture proves
otherwise. While in this block, refresh the stale sentence in the
`CorrectHydratedSubdocumentIds` JSDoc that says Mongoose 9.9.1 exposes a
required `_id: unknown`: on 9.9.4 the observed phantom type is
`Types.ObjectId`, and the workaround is still required (verified up to
9.9.4). Comment-only change.

**Fixture (write first):** extend `src/models/__fixtures__/nestedPathIds.ts`
(the `_id`-placement fixture). Add to `NestedPathModel.modelSchema` two
single-nested subdocuments, `flagged: { type: { label: { type: String } }, _id: false }`
(sibling spelling) and `inside: { type: { _id: false, label: { type: String } } }`
(inside spelling), and assert with the file's `HasKey` helper that `_id` is
absent on the hydrated document for both, absent on the raw document for
both, and still present for the existing `wrapped` subdocument. Extend the
file's header comment with one paragraph on the two `_id: false` spellings.
RED: the hydrated `flagged` assertion fails. GREEN after the fix; the entire
existing gate must stay green.

### Task 3: Type every virtual shape instead of collapsing to `never`

**File:** `src/modules/BaseModel.ts`, `VirtualType` (around lines 547-549):

```ts
export type VirtualType<T> = {
  [P in keyof T]: T[P] extends { get: () => infer R } ? R : never;
};
```

Only a zero-argument getter is understood. A getter that takes Mongoose's
`(value, virtual, doc)` arguments, a set-only virtual, and a populate virtual
(`{ options: { ref, localField, foreignField } }`, no getter) all resolve to
`never`, which is assignable to anything, so wrong code compiles silently.
Replace the mapping with:

```ts
export type VirtualType<T> = {
  [P in keyof T]: T[P] extends { get: (...args: never[]) => infer R }
    ? R
    : T[P] extends { set: (value: infer V, ...rest: never[]) => unknown }
      ? V
      : unknown;
};
```

Rules: a getter's return type wins whatever its parameters; a set-only
virtual is typed by its setter's value parameter (write-side correctness;
reading a set-only virtual is a misuse); a virtual with neither (populate
virtuals) is `unknown`, which is honest — the populated shape is not
knowable from the schema — and forces a narrowing instead of silently
compiling. Update the JSDoc on `VirtualType` (there is none today; add a
compact one stating those three rules). No call sites change.

**Fixture (write first):** new `src/models/__fixtures__/virtualShapes.ts`,
self-contained, header comment in the sibling files' voice, exact-type
assertions on the class-derived hydrated document for a model whose
`modelVirtuals` (returned `as const`) declares: a plain getter returning
`number`; an `async` getter (exactly `Promise<number>`); a get+set pair
(`string`); a set-only virtual (`string`, the setter's value type); a getter
declared with Mongoose's extra arguments `(this: Doc, value: unknown)`
returning `string`; and a populate virtual with only `options: { ref, localField, foreignField }`
(exactly `unknown`). Also show the populate virtual narrowing without a cast
(`Array.isArray(doc.related)` then indexing) and that assigning through the
set-only virtual compiles. Add `virtualShapes.ts` to the fixture list in the
header comment of `src/models/ModelTyping.typecheck.test.ts`. RED: the
set-only, extra-argument and populate assertions fail. GREEN after the fix;
the entire existing gate must stay green (note `liteModelType.ts` already
declares a populate virtual and must keep compiling).

### Task 4: Make the runtime-name model type queryable

**File:** `src/server.ts`. Today

```ts
export type AppModel = AbstractModel['mongooseModel'] | TBaseModel;
```

is the return type of `getModelOrThrow(name: string)` and of
`getModel(FrameworkModelName)`. A union of two differently parameterised
Mongoose models makes every overloaded query method uncallable:
`findOne`, `find` and `findById` fail with TS2740 while `create`,
`updateOne`, `deleteMany` and `countDocuments` happen to resolve. Change it to

```ts
export type AppModel = TBaseModel;
```

with the JSDoc updated to say that a model resolved by runtime name is typed
as a BaseModel-shaped Mongoose model, and that legacy `AbstractModel`-based
models are stored under the same type until v6 removes them. Update the
`cache.models` map type (the `Map<string, AbstractModel['mongooseModel'] | TBaseModel>`
declarations near lines 27 and 150) to `Map<string, AppModel>`, and at the
single place a legacy model is stored (around line 483-484,
`this.cache.models.set(modelName, model.mongooseModel)`) cast at that
boundary with a one-line comment naming why (legacy model shape, removed in
v6). Prefer a single `as AppModel`; use `as unknown as AppModel` only if
TypeScript rejects the direct cast. Keep the `AbstractModel` type import (the
`modelConstructors` map still needs it). Grep `src/` for other references to
`AbstractModel['mongooseModel']` and align them the same way if any exist
outside tests.

**Fixture (write first):** in `src/codegen/__fixtures__/appModelLookup.ts`,
after `const runtimeModel: AppModel = app.getModelOrThrow(runtimeName);`, add
calls proving the runtime-name model is queryable:
`void runtimeModel.findOne({}); void runtimeModel.find({}); void runtimeModel.findById('x'); void runtimeModel.countDocuments({});`.
RED: `node --test --import=./src/tests/setupNodeTest.ts src/codegen/routeTypes.golden.test.ts`
(or whichever invocation that test needs — check the `t` script in
`package.json`) reports TS2740 on the finder calls. GREEN after the change;
the rest of that fixture (the `AppModel & { … }` intersections, the
`@ts-expect-error` lines) must still hold. Also confirm `npm run check:types`
and `npm run check:types:tests` are green — `src/tests/testHelpers.ts` and
the model tests cast `getModel(...)` results and must not regress.

## Out of scope

Everything listed under "Not in scope" in **Why**; the docs repo (three wrong
examples and a phantom "5.2.3" version floor are tracked in the audit notes);
the example project; `select-projection-typing` (separate `later/` plan).

Found during review, deliberately left open (each needs its own fixture first):

- **Subdocument arrays with the sibling marker** — `field: { type: [{ … }], _id: false }`
  drops the child `_id` at runtime, but `SchemaArrayElement` unwraps to the
  element definition and loses the wrapper's `_id: false`, so hydrated elements
  still type `_id: Types.ObjectId`. Same shape as Task 2, in the array branch of
  `CorrectHydratedSubdocumentIds` (and `CorrectRawSubdocumentIds`). The inside
  spelling in an array is handled.
- **Set-only virtuals on `as const` models are read-only.** `VirtualType` is
  homomorphic, so `as const` virtuals project `readonly`; assigning through a
  set-only virtual only compiles on a non-`as const` `modelVirtuals`. A
  follow-up should strip `readonly` on the setter branch only — a blanket
  `-readonly` would make getter-only virtuals assignable, which is worse.
- **A custom `id` virtual** is intersected with Mongoose's default `id: string`
  (`AddDefaultId` keys off an `id` schema *path*), so one returning anything but
  a string collapses to `never`. Upstream behaviour; declare it as a path or
  rename it.
